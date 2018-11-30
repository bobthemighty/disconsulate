const isequal = require("lodash.isequal");
const { expect, fail } = require("code");
const Lab = require("lab");
const { after, before, describe, it, afterEach } = (exports.lab = Lab.script());

const zurvan = require("zurvan");

const Http = require("http");
const Disconsulate = require("../");

class FakeConsul {
  constructor() {
    this.responses = [];
    this.requests = [];
    this.server = null;
  }

  addResponse(response = {}) {
    this.responses.push(response);
  }

  async start() {
    const consul = this;
    this.server = Http.createServer((req, res) => {
      const { statusCode = 200, body, index } = consul.responses.shift();
      consul.requests.push(req);
      const headers = {
        "Content-Type": "application/json"
      };

      if (index !== undefined) {
        headers["X-Consul-Index"] = index;
      }
      res.writeHead(statusCode, headers);
      res.end(body);
    });
    await this.server.listen(0);
  }

  getAddress() {
    return `http://localhost:${this.server.address().port}`;
  }
}

class TestLogger {
  constructor() {
    this.debugs = [];
    this.infos = [];
    this.errors = [];
    this.fatals = [];
  }
  debug(m) {
    this.debugs.push(m);
  }

  info(m) {
    this.infos.push(m);
  }

  error(m) {
    this.errors.push(m);
  }

  fatal(m) {
    this.fatals.push(m);
  }
}

class TestClient {
  constructor(address, expected, options) {
    options = options || {};
    this.logger = new TestLogger();
    options.logger = this.logger;
    this.client = new Disconsulate(address, options);
    this.results = [];
    this.errors = [];
    this.failed = false;
    this.expected = expected;

    this.client.on("change", e => {
      this.results.push(e.nodes.slice(0));
    });

    this.client.on("error", e => {
      this.errors.push(e);
    });

    this.client.on("fail", () => {
      this.failed = true;
    });
  }

  async getService(service, opts) {
    const result = await this.client.getService(service, opts);
    return result;
  }

  done() {
    return new Promise((resolve, reject) => {
      if (this.results.length >= this.expected) {
        console.log(this.results.length);
        resolve();
      }
      this.client.on("change", () => {
        if (this.results.length >= this.expected) {
          resolve();
        }
      });
    });
  }

  nextError() {
    return new Promise((resolve, reject) => {
      this.client.once("error", resolve);
    });
  }
}

describe("getService", async () => {
  let client = null;

  const ServiceName = "nginx-stats";

  const consul = new FakeConsul();
  consul.addResponse({
    body: JSON.stringify([
      { Service: { Address: "10.0.0.1", Port: "1234", Tags: ["active"] } },
      { Service: { Address: "10.0.0.2", Port: "2345", Tags: ["passive"] } }
    ])
  });

  before(async () => {
    await consul.start(0);
    client = new TestClient(consul.getAddress());
    await client.getService(ServiceName);
  });

  it("calls the configured address", () => {
    expect(consul.requests[0]).to.exist();
  });

  it("calls the health endpoint", () => {
    expect(consul.requests[0].url).to.equal(
      "/v1/health/service/nginx-stats?passing=1&near=agent"
    );
  });

  it("returns the first of the registered services", () => {
    const [result] = client.results[0];
    expect(result.address).to.equal("10.0.0.1");
    expect(result.port).to.equal("1234");
    expect(result.tags).to.equal(["active"]);
  });

  it("cycles through all registered services when asked again", async () => {
    let result = await client.getService(ServiceName);
    expect(result.address).to.equal("10.0.0.2");
    expect(result.port).to.equal("2345");
    expect(result.tags).to.equal(["passive"]);

    result = await client.getService(ServiceName);
    expect(result.address).to.equal("10.0.0.1");

    result = await client.getService(ServiceName);
    expect(result.address).to.equal("10.0.0.2");
  });
});

describe("When the server returns X-Consul-Index", () => {
  const consul = new FakeConsul();

  consul.addResponse({
    body: JSON.stringify([{ Service: { Address: "server-1", Port: "1" } }]),
    index: 1
  });

  consul.addResponse({
    body: JSON.stringify([{ Service: { Address: "server-2", Port: "2" } }]),
    index: 2
  });

  consul.addResponse({
    body: JSON.stringify([{ Service: { Address: "server-3", Port: "3" } }]),
    index: 3
  });

  consul.addResponse({
    body: JSON.stringify([{ Service: { Address: "server-3", Port: "3" } }])
  });

  before(async () => {
    await consul.start(0);
    const client = new TestClient(consul.getAddress(), 3);
    await client.getService("foo");
    await client.done();
  });

  it("should make three requests to the server", () => {
    expect(consul.requests.length).to.equal(3);
  });

  it("should include the index when calling for updates", () => {
    expect(consul.requests[1].url).endsWith("&index=1");
    expect(consul.requests[2].url).endsWith("&index=2");
  });
});

describe("When the index changes but nodes remain the same", () => {});

describe("When specifying additional options", () => {
  const consul = new FakeConsul();
  consul.addResponse({
    body: JSON.stringify([{ Service: { address: "10.0.0.1", port: "1234" } }])
  });

  before(async () => {
    await consul.start();
    const client = new TestClient(consul.getAddress());
    await client.getService("baz", {
      tags: ["active", "release-123"],
      dc: "eu-west-1"
    });
  });

  it("calls the health endpoint", () => {
    expect(consul.requests[0].url).to.equal(
      "/v1/health/service/baz?passing=1&near=agent&dc=eu-west-1&tag=active&tag=release-123"
    );
  });
});

describe("When specifying node metadata", () => {
  let request = null;
  const consul = new FakeConsul();
  consul.addResponse({
    body: JSON.stringify([
      { Service: { Address: "configured.com", Port: "1234" } }
    ])
  });

  before(async () => {
    await consul.start();
    const client = new TestClient(consul.getAddress());
    await client.getService("baz", {
      node: {
        availabilityZone: "A",
        type: "t2.micro"
      }
    });
  });

  it("calls the health endpoint", () => {
    expect(consul.requests[0].url).to.equal(
      "/v1/health/service/baz?passing=1&near=agent&node-meta=availabilityZone:A&node-meta=type:t2.micro"
    );
  });
});

describe("When no consul addr is provided", () => {
  afterEach(() => {
    delete process.env.CONSUL_ADDR;
    delete process.env.CONSUL_HOST;
    delete process.env.CONSUL_PORT;
  });

  it("uses the CONSUL_ADDR var if available", () => {
    process.env.CONSUL_ADDR = "http://foo.com:999";
    const client = new Disconsulate();
    expect(client.consulAddr).to.equal("http://foo.com:999");
  });

  it("uses the CONSUL_HOST and CONSUL_PORT vars if available", () => {
    process.env.CONSUL_HOST = "bar.net";
    process.env.CONSUL_PORT = "8172";
    const client = new Disconsulate();
    expect(client.consulAddr).to.equal("http://bar.net:8172");
  });

  it("defaults to consul:8500", () => {
    const client = new Disconsulate();
    expect(client.consulAddr).to.equal("http://consul:8500");
  });
});

describe("When the response is large", () => {
  let result;
  const consul = new FakeConsul();

  const data = [];
  for (let i = 0; i < 10000; i++) {
    data.push({
      Service: {
        Address: "machine-" + i,
        Port: i
      }
    });
  }

  consul.addResponse({ body: JSON.stringify(data) });

  before(async () => {
    await consul.start();
    const client = new TestClient(consul.getAddress());
    result = await client.getService("baz", {
      node: {
        availabilityZone: "A",
        type: "t2.micro"
      }
    });
  });

  it("calls the health endpoint", () => {
    expect(consul.requests[0].url).to.equal(
      "/v1/health/service/baz?passing=1&near=agent&node-meta=availabilityZone:A&node-meta=type:t2.micro"
    );
  });
});

describe("When the response is empty", () => {
  let client;
  const consul = new FakeConsul();

  const data = [];

  consul.addResponse({ body: JSON.stringify(data) });

  before(async () => {
    await consul.start();
    client = new TestClient(consul.getAddress());
  });

  it("raises an error", async () => {
    try {
      result = await client.getService("baz");
      fail("Expected error");
    } catch (e) {
      expect(e.message).to.equal("No nodes found for service 'baz'");
    }
  });
});

describe("When the server fails with error text", () => {
  const consul = new FakeConsul();
  let client;

  consul.addResponse({ statusCode: 500, body: "That didn't work" });

  before(async () => {
    await consul.start();
    client = new TestClient(consul.getAddress());
  });

  it("propagates the error", async () => {
    try {
      const value = await client.getService("some-service");
      fail("Expected an error, but received value: " + JSON.stringify(result));
    } catch (e) {
      expect(e.message).to.endWith(
        "/v1/health/service/some-service?passing=1&near=agent: That didn't work"
      );
    }
  });

  it("logs the error", () => {
    expect(client.logger.errors).to.have.length(1);
  });
});

describe("When the server fails", () => {
  let request = null;

  const server = Http.createServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    request = req;
    res.end();
  });

  before(async () => {
    await server.listen(0);
  });

  it("propagates the error", async () => {
    const client = new TestClient(`http://localhost:${server.address().port}`);

    try {
      const value = await client.getService("some-service");
      fail("Expected an error, but received value: " + JSON.stringify(result));
    } catch (e) {}
  });
});

describe("When there is no server", () => {
  let request = null;

  it("propagates the error", async () => {
    const client = new TestClient("http://localhost:0");

    try {
      const value = await client.getService("some-service");
      fail("Expected an error, but received value: " + JSON.stringify(result));
    } catch (e) {}
  });
});

describe("When we receive no services", async () => {
  let request = null;
  let result = null;
  let client = null;
  const consul = new FakeConsul();
  consul.addResponse({ body: "[]" });

  before(async () => {
    await consul.start();
    client = new TestClient(consul.getAddress());
  });

  it("Fails with an error", async () => {
    try {
      result = await client.getService("foo");
      fail("Expected failure but received result " + JSON.stringify(result));
    } catch (e) {}
  });
});

describe("When we receive an HTTP error from a watch request", async () => {
  const consul = new FakeConsul();
  let client;

  consul.addResponse({
    body: JSON.stringify([{ Service: { Address: "server-1", Port: "1" } }]),
    index: 1
  });

  for (let i = 0; i < 10; i++) {
    consul.addResponse({
      statusCode: 502,
      body: "That's not what we want to happen AT ALL!!! (" + i + ")"
    });
  }

  consul.addResponse({
    body: JSON.stringify([{ Service: { Address: "server-2", Port: "2" } }])
  });

  before(async () => {
    await zurvan.interceptTimers();
    await consul.start();
    client = new TestClient(consul.getAddress(), 2, {
      retry: {
        seedDelay: 100,
        maxDelay: 2000,
        maxTries: 50
      }
    });
    await client.getService("foo");

    await client.nextError();
  });

  after(async () => {
    await zurvan.releaseTimers();
  });

  it("should raise 'error'", () => {
    expect(client.errors).to.have.length(1);
  });

  it("should have fetched the first result", () => {
    expect(client.results).to.have.length(1);
  });

  it("should retry within 2 seconds", async () => {
    await zurvan.advanceTime(2000);
    await client.nextError();
    expect(client.errors).to.have.length(2);
  });

  it("should retry 10 times in total", async () => {
    for (let i = 2; i <= 10; i++) {
      await zurvan.advanceTime(2000);
      if (i <= 9) {
        await client.nextError();
      }
    }
    await client.done();
    expect(client.errors).to.have.length(10);
  });

  it("should have fetched the second result", () => {
    expect(client.results).to.have.length(2);
  });
});

describe("When we exceed the max retries", async () => {
  const consul = new FakeConsul();
  let client;

  consul.addResponse({
    body: JSON.stringify([{ Service: { Address: "server-1", Port: "1" } }]),
    index: 1
  });

  for (let i = 0; i < 10; i++) {
    consul.addResponse({
      statusCode: 502,
      body: "That's not what we want to happen AT ALL!!! (" + i + ")"
    });
  }

  before(async () => {
    await zurvan.interceptTimers();
    await consul.start();
    client = new TestClient(consul.getAddress(), 2, {
      retry: {
        seedDelay: 1000,
        maxDelay: 5000,
        maxTries: 5
      }
    });
    await client.getService("foo");
    await client.nextError();
  });

  after(async () => {
    await zurvan.releaseTimers();
  });

  it("should raise 'error'", () => {
    expect(client.errors).to.have.length(1);
  });

  it("should have fetched the first result", () => {
    expect(client.results).to.have.length(1);
  });

  it("should before 3 seconds", async () => {
    await zurvan.advanceTime(3000);
    await client.nextError();
    expect(client.errors).to.have.length(2);
  });

  it("should retry 5 times in total", async () => {
    for (let i = 2; i <= 5; i++) {
      await zurvan.advanceTime(5000);
      await client.nextError();
    }
    expect(client.errors).to.have.length(5 + 1);
  });

  it("should have raised fail", () => {
    expect(client.failed).to.be.true();
  });
});

describe("When the set of services doesn't change", () => {
  const consul = new FakeConsul();
  let client;

  // First we return two services
  consul.addResponse({
    body: JSON.stringify([
      { Service: { Address: "server-1", Port: "1" } },
      { Service: { Address: "server-2", Port: "2" } }
    ]),
    index: 1
  });

  // Then the same services in the opposite order
  consul.addResponse({
    body: JSON.stringify([
      { Service: { Address: "server-2", Port: "2" } },
      { Service: { Address: "server-1", Port: "1" } }
    ]),
    index: 2
  });

  // Then the same services again
  consul.addResponse({
    body: JSON.stringify([
      { Service: { Address: "server-2", Port: "2" } },
      { Service: { Address: "server-1", Port: "1" } }
    ]),
    index: 3
  });

  // Then a subset of the original services
  consul.addResponse({
    body: JSON.stringify([{ Service: { Address: "server-1", Port: "1" } }]),
    index: 4
  });

  // and lastly a new service
  consul.addResponse({
    body: JSON.stringify([{ Service: { Address: "server-3", Port: "3" } }])
  });

  before(async () => {
    await consul.start();
    client = new TestClient(consul.getAddress(), 3);
    await client.getService("foo");
    await client.done();
  });

  it("should make five requests to the server", () => {
    expect(consul.requests.length).to.equal(5);
  });

  it("should only raise 'change' when the set of services changes", () => {
    expect(client.results).to.have.length(3);
  });

  it("should raise for the first set of services", () => {
    const [s1, s2] = client.results[0];
    expect(s1.address).to.equal("server-1");
    expect(s2.address).to.equal("server-2");
  });

  it("should raise for the subset", () => {
    const [s1] = client.results[1];
    expect(s1.address).to.equal("server-1");
  });

  it("should raise for the new service", () => {
    const [s1] = client.results[2];
    expect(s1.address).to.equal("server-3");
  });
});
