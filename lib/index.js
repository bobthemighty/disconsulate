"use strict";
const http = require("http");
const { URL } = require("url");

const pathStem = "v1/health/service/";

class ServiceDescriptor {
  constructor(
    service,
    { near = "agent", passing = 1, tags = [], dc, node = {} } = {}
  ) {
    this.path = pathStem + service;
    this.uri = this.getUri(this.path, {
      passing,
      near,
      dc,
      tags,
      node
    });
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
}

function get(url) {
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
            resolve(json);
            return;
          }
          const text = body ? body.toString() : "";
          reject(
            new Error(
              `Received ${res.statusCode} response from ${url}: ${text}`
            )
          );
        });

        res.on("error", e => {
          reject(e);
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

module.exports = class Disconsulate {
  constructor({ consul } = {}) {
    this.consulAddr = consul || process.env.CONSUL_ADDR;
  }

  getService(service, opts) {
    const desc = new ServiceDescriptor(service, opts);
    return get(`${this.consulAddr}/${desc.uri}`).then(res => {
      return res[0].Service;
    });
  }
};
