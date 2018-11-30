"use strict";
const http = require("http");
const { URL } = require("url");
const { EventEmitter } = require("events");
const isequal = require("lodash.isequal");

const pathStem = "v1/health/service/";

class Service {
  constructor(address, port, tags) {
    this.address = address;
    this.port = port;
    this.tags = tags;
  }
}

// honestly too boring to test
/* $lab:coverage:off$ */
class StubLogger {
  constructor(debug) {
    if (debug) {
      this.debug = console.log;
    } else {
      this.debug = () => {};
    }
    this.info = console.log;
    this.error = console.log;
    this.fatal = console.log;
  }
}
/* $lab:coverage:on$ */

class ServiceDescriptor {
  constructor(
    service,
    { near = "agent", passing = 1, tags = [], dc, node = {} } = {}
  ) {
    this.service = service;
    this.tags = tags;
    this.dc = dc;
    this.node = node;
    this.path = pathStem + service;
    this.uri = this.getUri(this.path, {
      passing,
      near,
      dc,
      tags,
      node
    });
    this._yieldIdx = 0;
    this.nodes = [];
  }

  getUri(path, queryObj) {
    const query = [];
    Object.getOwnPropertyNames(queryObj).forEach(p => {
      if (queryObj[p] === undefined) {
        return;
      }
      if (p === "node") {
        Object.getOwnPropertyNames(queryObj.node).forEach(p => {
          query.push(`node-meta=${p}:${queryObj.node[p]}`);
        });
      } else if (p === "tags") {
        let tags = queryObj["tags"];
        tags.forEach(t => {
          query.push(`tag=${t}`);
        });
      } else {
        query.push(`${p}=${queryObj[p]}`);
      }
    });
    return `${path}?${query.join("&")}`;
  }

  next() {
    if (this.nodes.length == 0) {
      return Promise.reject(new Error(`No nodes found for service '${this.describe()}'`));
    }
    if (this._yieldIdx >= this.nodes.length) {
      this._yieldIdx = 0;
    }
    let node = this.nodes[this._yieldIdx++];
    return Promise.resolve(node);
  }

  describe () {
    if (this._description !== undefined) {
      return this._description;
    }
    const bits = [];

    if (this.dc) {
      bits.push(`${this.service}@${this.dc}`);
    } else {
      bits.push(`${this.service}`);
    }

    if (this.tags.length > 0) {
      bits.push(this.tags.join(","));
    }

    if(Object.keys(this.node).length > 0) {
      bits.push("with node-meta:");
      bits.push(JSON.stringify(this.node));
    }

    this._description = bits.join(" ");
    return this._description;
  }
}

function get(url, isWatch = false) {
  url = new URL(url);
  return new Promise((resolve, reject) => {
    let body;
    const req = http.request(
      {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET"
      },
      res => {
        res.on("data", chunk => {
          if (body === undefined) {
            body = Buffer.from(chunk);
          } else {
            body = Buffer.concat([body, chunk]);
          }
        });

        res.on("end", () => {
          if (res.statusCode == 200) {
            const json = JSON.parse(body);
            const index = res.headers["x-consul-index"];
            const nodes = json.map(
              s =>
                new Service(s.Service.Address, s.Service.Port, s.Service.Tags)
            );
            resolve([index, nodes]);
            return;
          }
          const text = body ? body.toString() : "";
          reject(
            new Error(
              `Received ${res.statusCode} response from ${url}: ${text}`
            )
          );
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function* getSleep(seedWait, maxWait, maxTries) {
  let tries = 0;
  let current = seedWait;

  while (++tries <= maxTries) {
    current = Math.min(
      maxWait,
      Math.max(seedWait, current * 3 * Math.random())
    );
    yield current;
  }
}

module.exports = class Disconsulate extends EventEmitter {
  constructor(consul, options = {}) {
    super();
    const retry = options.retry || {};
    this.seed = retry.seedDelay || 1000;
    this.max = retry.maxDelay || 5000;
    this.retries = retry.maxTries || 10;
    this.logger = options.logger || new StubLogger();
    this.consulAddr = consul || process.env.CONSUL_ADDR;
    if (this.consulAddr === undefined) {
      this.consulAddr = `http://${process.env.CONSUL_HOST || "consul"}:${process
        .env.CONSUL_PORT || "8500"}`;
    }
    this.cache = {};
  }

  handleError(e, isWatch, desc, waiter) {
    this.logger.error(e);
    this.emit("error", e);

    if (!isWatch) {
      throw e;
    }

    const wait = waiter.next();
    if (wait.done) {
      this.logger.fatal(
        `Maximum retries reached fetching service ${desc.describe()}: ${e}`
      );
      this.emit("fail");
    } else {
      setTimeout(() => {
        this.watchService(desc, true, waiter);
      }, wait.value);
    }
  }

  async insertToCache(desc, isWatch, waiter) {
    let uri = `${this.consulAddr}/${desc.uri}`;
    this.logger.debug(`Refreshing service ${desc.describe()} from uri ${uri}`);
    if (desc.index !== undefined) {
      uri += "&index=" + desc.index;
    }

    try {
      const [index, nodes] = await get(uri);
      this.cache[desc.uri] = desc;
      desc.index = index;
      if (!isequal(new Set(nodes), new Set(desc.nodes))) {
        this.logger.info(`Received new addresses for service ${desc.describe()}: ${JSON.stringify(nodes, null, 2)}`)
        desc.nodes = nodes;
        this.emit("change", desc);
      }
      return index;
    } catch (e) {
      this.handleError(e, isWatch, desc, waiter);
    }
  }

  async watchService(desc, isWatch, waiter) {
    const index = await this.insertToCache(desc, isWatch, waiter);

    if (index !== undefined) {
      process.nextTick(() => {
        this.watchService(
          desc,
          true,
          getSleep(this.seed, this.max, this.retries)
        );
      });
    }

    return index;
  }

  async getService(service, opts) {
    const desc = new ServiceDescriptor(service, opts);
    const path = desc.uri;

    if (this.cache[desc.uri]) {
      const value = this.cache[desc.uri].next();
      this.logger.debug(`${desc.describe()} is cached, returning ${value}`);
      return value;
    }

    this.logger.debug(`${desc.describe()} is not cached, fetching for the first time.`);
    const index = await this.watchService(
      desc,
      false,
      getSleep(this.seed, this.max, this.retries)
    );

    return desc.next();
  }
};
