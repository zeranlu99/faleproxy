const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { sampleHtmlWithYale } = require('./test-utils');
const nock = require('nock');

// Set a different port for testing to avoid conflict with the main app
const TEST_PORT = 3099;
let server;
let serverPid;

describe.skip('Integration Tests', () => {
  // Modify the app to use a test port
  beforeAll(async () => {
    // Mock external HTTP requests
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    nock.enableNetConnect('localhost');
    
    // Create a temporary test app file
    await execAsync('cp app.js app.test.js');
    await execAsync(`sed -i '' 's/const PORT = 3001/const PORT = ${TEST_PORT}/' app.test.js`);
    
    // Start the test server
    server = require('child_process').spawn('node', ['app.test.js'], {
      detached: true,
      stdio: 'ignore'
    });
    serverPid = server.pid;
    
    // Give the server time to start
    await new Promise(resolve => setTimeout(resolve, 2000));
  }, 10000); // Increase timeout for server startup

  afterAll(async () => {
    // Kill the test server and clean up
    if (serverPid) {
      try {
        process.kill(-serverPid, 'SIGTERM');
      } catch (e) {
        // Ignore errors if process already dead
      }
    }
    try {
      await execAsync('rm -f app.test.js');
    } catch (e) {
      // Ignore errors
    }
    nock.cleanAll();
    nock.enableNetConnect();
  });

  test('Should replace Yale with Fale in fetched content', async () => {
    // Setup mock for example.com
    nock('https://example.com')
      .get('/')
      .reply(200, sampleHtmlWithYale);
    
    // Make a request to our proxy app
    let response;
    try {
      response = await axios.post(`http://localhost:${TEST_PORT}/fetch`, {
        url: 'https://example.com/'
      });
    } catch (error) {
      throw new Error(`Failed to fetch: ${error.message}`);
    }
    
    const { status, data } = response;
    
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    
    // Verify Yale has been replaced with Fale in text
    const $ = cheerio.load(data.content);
    expect($('title').text()).toBe('Fale University Test Page');
    expect($('h1').text()).toBe('Welcome to Fale University');
    expect($('p').first().text()).toContain('Fale University is a private');
    
    // Verify URLs remain unchanged
    const links = $('a');
    let hasYaleUrl = false;
    links.each((i, link) => {
      const href = $(link).attr('href');
      if (href && href.includes('yale.edu')) {
        hasYaleUrl = true;
      }
    });
    expect(hasYaleUrl).toBe(true);
    
    // Verify link text is changed
    expect($('a').first().text()).toBe('About Fale');
  }, 10000); // Increase timeout for this test

  test('Should handle invalid URLs', async () => {
    try {
      const response = await axios.post(`http://localhost:${TEST_PORT}/fetch`, {
        url: 'not-a-valid-url'
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      const { status } = error.response || {};
      expect(status).toBe(500);
    }
  });

  test('Should handle missing URL parameter', async () => {
    try {
      const response = await axios.post(`http://localhost:${TEST_PORT}/fetch`, {});
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      const { status, data } = error.response || {};
      expect(status).toBe(400);
      expect(data.error).toBe('URL is required');
    }
  });
});
