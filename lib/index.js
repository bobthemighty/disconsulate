"use strict";
const http = require("http");

const pathStem = "v1/health/service/";

class ServiceDescriptor {
  constructor(service, { near = "agent", passing = 1 } = {}) {
    this.path = pathStem + service;
    this.uri = this.getUri(this.path, {
      passing,
      near
    });
  }

  getUri(path, queryObj) {
    const query = [];
    Object.getOwnPropertyNames(queryObj).forEach(p => {
      if (queryObj[p] === undefined) {
        return;
      }
      if (p === "nodeMeta") {
        Object.getOwnPropertyNames(queryObj.nodeMeta).forEach(p => {
          query.push(`node-meta=${p}=${queryObj.nodeMeta[p]}`);
        });
      } else {
        query.push(`${p}=${queryObj[p]}`);
      }
    });
    return `${path}?${query.join("&")}`;
  }
}

function get(url) {
  url = typeof url === "string" ? new URL(url) : url;
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
        res.setEncoding("utf8");

        res.on("data", chunk => {
          if (body === undefined) {
            body = Buffer.from(chunk);
          } else {
            body = Buffer.concat([body, chunk]);
          }
        });

        res.on("end", () => {
          const json = JSON.parse(body);
          resolve(json);
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

  getService(service) {
    const desc = new ServiceDescriptor(service);
    return get(`${this.consulAddr}/${desc.uri}`);
  }
};
