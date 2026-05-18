const axios = require('axios');
const http  = require('http');
const https = require('https');

const BASE_URL = 'https://mangadistrict.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': BASE_URL + '/',
};

// Axios instance with keep-alive for connection reuse across requests
const axiosInstance = axios.create({
  headers: HEADERS,
  timeout: 20000,
  httpAgent:  new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
});

module.exports = { axiosInstance, HEADERS, BASE_URL };
