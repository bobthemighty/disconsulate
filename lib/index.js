'use strict';
const fetch = require('node-fetch');


module.exports = class Disconsulate {

  constructor({consul} = {}) {
    this.consul_addr = consul || process.env.CONSUL_ADDR;
  }

  getService(service) {
    return fetch(`${this.consul_addr}/v1/health/service/${service}`);
  }

};
