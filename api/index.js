import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '../dist/server/server.js');

// Import the built server handler
const serverModule = await import(serverPath);
const serverHandler = serverModule.default;

export default async function handler(req, res) {
  try {
    // Convert Node.js request/response to Fetch API Request/Response
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = new URL(req.url, `${protocol}://${host}`);
    
    const fetchRequest = new Request(url.toString(), {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v)])
      ),
      body: ['GET', 'HEAD'].includes(req.method) ? null : req,
    });

    // Call the TanStack Start server handler
    const fetchResponse = await serverHandler.fetch(fetchRequest, {}, {});

    // Set response status
    res.statusCode = fetchResponse.status;
    
    // Set response headers
    fetchResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Send response body
    if (fetchResponse.body) {
      const buffer = await fetchResponse.arrayBuffer();
      res.end(Buffer.from(buffer));
    } else {
      res.end();
    }
  } catch (error) {
    console.error('[v0] Server error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Internal Server Error');
  }
}
