# disconsulate
A light-weight loadbalancing service discovery lib for Consul

[![Status](https://travis-ci.org/bobthemighty/disconsulate.svg?branch=master)](https://travis-ci.org/bobthemighty/disconsulate)  
[![node](https://img.shields.io/node/v/disconsulate.svg)](https://www.npmjs.com/package/disconsulate)

Disconsulate is an opinionated wrapper for Consul's service discovery API. It's heavily inspired by [Consulite](https://www.npmjs.com/package/consulite) but has a few more tricks up its sleeve.

It's built to have minimal dependencies and a tiny API.

## Installation

`npm install disconsulate`

## Usage

```js

import Disconsulate from 'disconsulate;'

// Disconsulate uses async functions when talking to Consul.
async function fetch_database() {
  
  // Create a client by passing it the address of a consul server.
  // If you don't provide a server address, disconsulate will use the value
  // of the environment variable "CONSUL_ADDR"
  const client = new Disconsulate("http://consul.local:8500");

  // Disconsulate will raise events when a watched service changes, you can
  // use this to tear down connections, or reload config.
  client.on("change", (service) => console.log(service));

  // getService returns a promise of a registered service.
  // Disconsulate will round-robin each registered address and watches
  // services in the background to automatically update its cache.
  try {
      const database = await client.getService("database");
      const database_2 = await client.getService("database");

      console.log(`The database is available at ${database.address}:${database.port}`);
  } catch (e) {
  // If we can't find any services, we'll raise an error at this point.
      console.log("No registration found for database", e);
  }
}
```

## API

### new Disconsulate(options)

Create a new instance of the Consulite class. `options` can include the following properties:

* `consul` - consul host to connect to. Defaults to either:
  * `${process.env.CONSUL_ADDR}`
  * `${process.env.CONSUL_HOST}:${process.env.CONSUL_PORT}`
  * `consul:8500` - as a last resort

### getService(name, [options]) 

Start watching a service, and return a registered address and port.

* `name`: the service name as registered with Consul.
* `options`: an object with the following properties
  * `dc`: the datacentre to search for registered services.
  * `tags`: an array of that must be registered on an instance, used for filtering the registered addresses.
  * `node`: an object of key/value pairs that will be used to filter by node metadata.

Returns a promise of a service instance `{ address: string, port: string }`

Disconsulate's `getService` method is able to watch multiple configurations for the same service. In the following example, we set up three separate caches which can update individually.

```js
const client = new Disconsulate();

const live = client.getService("payment-api", {
   tags: ["live"]
});

const dev = client.getService("payment-api", {
   tags: ["dev"]
});

const europe = client.getService("payment-api", {
   tags: ["live"],
   dc: "eu-west-1"
});
```
