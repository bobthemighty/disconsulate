"use strict";
const phin = require("phin");

module.exports = class Disconsulate {
  constructor({ consul } = {}) {
    this.consulAddr = consul || process.env.CONSUL_ADDR;
  }

  getService(service) {
    return phin(`${this.consulAddr}/v1/health/service/${service}`);
  }
};
