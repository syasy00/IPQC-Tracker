import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, 'dist');

// Check if dist folder exists
if (!fs.existsSync(distPath)) {
  console.error('ERROR: dist folder not found at', distPath);
  process.exit(1);
}

console.log('Serving static files from:', distPath);

// Serve static files from dist directory
app.use(express.static(distPath));

// Handle client-side routing - send index.html for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
