'use strict';
const fetch = require('node-fetch');


module.exports = class Disconsulate {

  constructor(config) {
    this.config = config;
  }

  getService(service) {
    return fetch(`${this.config.consul}/v1/health/service/${service}`);
  }

};
