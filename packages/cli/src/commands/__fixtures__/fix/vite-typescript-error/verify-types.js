const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'src', 'main.ts'), 'utf-8');

if (source.includes('"oops"')) {
  console.error("src/main.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.");
  process.exit(1);
}

console.log(`Local: http://localhost:${process.env.PORT || 3000}`);
setInterval(() => {}, 10000);
