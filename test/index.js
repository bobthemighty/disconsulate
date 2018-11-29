const isequal = require("lodash.isequal");
const { expect, fail } = require("code");
const Lab = require("lab");
const { after, before, describe, it } = (exports.lab = Lab.script());

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

describe("getService", async () => {
  let request = null;
  let result = null;
  let client = null;
  let events = [];

  const ServiceName = "nginx-stats";

  const consul = new FakeConsul();
  consul.addResponse({
    body: JSON.stringify([
      { Service: { Address: "10.0.0.1", Port: "1234" } },
      { Service: { Address: "10.0.0.2", Port: "2345" } }
    ])
  });

  before(async () => {
    await consul.start(0);
    client = new Disconsulate(consul.getAddress());
    client.on("change", e => {
      events.push(e);
    });
    result = await client.getService(ServiceName);
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
    expect(result.address).to.equal("10.0.0.1");
    expect(result.port).to.equal("1234");
  });

  it("cycles through all registered services when asked again", async () => {
    let result = await client.getService(ServiceName);
    expect(result.address).to.equal("10.0.0.2");
    expect(result.port).to.equal("2345");

    result = await client.getService(ServiceName);
    expect(result.address).to.equal("10.0.0.1");

    result = await client.getService(ServiceName);
    expect(result.address).to.equal("10.0.0.2");
  });

  it("raises a 'change' event", () => {
    expect(events).to.have.length(1);
  });

  it("includes the service descriptor", () => {
    const [descriptor] = events;
    expect(descriptor.service).to.equal(ServiceName);
  });
});

describe("When the server returns X-Consul-Index", () => {
  const consul = new FakeConsul();
  const events = [];
  const results = [];

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
    const client = new Disconsulate(consul.getAddress());
    const eventWaiter = new Promise((res, rej) => {
      client.on("change", e => {
        events.push(e);
        results.push(e.next());
        if (events.length == 3) {
          res();
        }
      });
    });
    await client.getService("foo");
    await eventWaiter;
  });

  it("should make three requests to the server", () => {
    expect(events.length).to.equal(3);
  });

  it("should include the index when calling for updates", () => {
    expect(consul.requests[1].url).endsWith("&index=1");
    expect(consul.requests[2].url).endsWith("&index=2");
  });
});

describe("When specifying additional options", () => {
  const consul = new FakeConsul();
  consul.addResponse({
    body: JSON.stringify([{ Service: { address: "10.0.0.1", port: "1234" } }])
  });

  before(async () => {
    await consul.start();
    const client = new Disconsulate(consul.getAddress());
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

  const server = Http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end(
      JSON.stringify([{ Service: { Address: "configured.com", Port: "1234" } }])
    );
  });

  before(async () => {
    await server.listen(0);
    process.env.CONSUL_ADDR = `http://localhost:${server.address().port}`;
    const client = new Disconsulate();
    await client.getService("baz", {
      node: {
        availabilityZone: "A",
        type: "t2.micro"
      }
    });
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.equal(
      "/v1/health/service/baz?passing=1&near=agent&node-meta=availabilityZone:A&node-meta=type:t2.micro"
    );
  });
});

describe("When using environment variables", async () => {
  let request = null;

  const server = Http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end(
      JSON.stringify([{ Service: { Address: "configured.com", Port: "1234" } }])
    );
  });

  before(async () => {
    await server.listen(0);
    process.env.CONSUL_ADDR = `http://localhost:${server.address().port}`;
    const client = new Disconsulate();
    await client.getService("bar");
  });

  after(async () => {
    delete process.env.CONSUL_ADDR;
  });

  it("calls the configured endpoint", () => {
    expect(request).to.not.be.null();
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.startWith("/v1/health/service/bar");
  });
});

describe("When the response is large", () => {
  let request = null;

  const server = Http.createServer((req, res) => {
    let data = [];
    for (let i = 0; i < 10000; i++) {
      data.push({
        Service: {
          Address: "machine-" + i,
          Port: i
        }
      });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end(JSON.stringify(data));
  });

  before(async () => {
    await server.listen(0);
    const client = new Disconsulate(
      `http://localhost:${server.address().port}`
    );
    await client.getService("baz", {
      node: {
        availabilityZone: "A",
        type: "t2.micro"
      }
    });
  });

  it("calls the health endpoint", () => {
    expect(request.url).to.equal(
      "/v1/health/service/baz?passing=1&near=agent&node-meta=availabilityZone:A&node-meta=type:t2.micro"
    );
  });
});

describe("When the server fails with error text", () => {
  const server = Http.createServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end("That didn't work");
  });

  before(async () => {
    await server.listen(0);
  });

  it("propagates the error", async () => {
    const client = new Disconsulate(
      `http://localhost:${server.address().port}`
    );

    try {
      const value = await client.getService("some-service");
      fail("Expected an error, but received value: " + JSON.stringify(result));
    } catch (e) {
      expect(e.message).to.endWith(
        "/v1/health/service/some-service?passing=1&near=agent: That didn't work"
      );
    }
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
    const client = new Disconsulate(
      `http://localhost:${server.address().port}`
    );

    try {
      const value = await client.getService("some-service");
      fail("Expected an error, but received value: " + JSON.stringify(result));
    } catch (e) {}
  });
});

describe("When there is no server", () => {
  let request = null;

  it("propagates the error", async () => {
    const client = new Disconsulate("http://consul.invalid");

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

  const server = Http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    request = req;
    res.end("[]");
  });

  before(async () => {
    await server.listen(0);
    client = new Disconsulate(`http://localhost:${server.address().port}`);
  });

  it("Fails with an error", async () => {
    try {
      result = await client.getService("foo");
      fail("Expected failure but received result " + JSON.stringify(result));
    } catch (e) {}
  });
});

describe("isequal", () => {
  let a = new Set([
    { address: "foo", port: 1234 },
    { address: "bar", port: 3456 },
    { address: "baz", port: 7890 }
  ]);

  let b = new Set([
    { address: "bar", port: 3456 },
    { address: "baz", port: 7890 },
    { address: "foo", port: 1234 }
  ]);

  it("Should have set equality for objects", () => {
    expect(isequal(a, b)).to.be.true();
  });
});
