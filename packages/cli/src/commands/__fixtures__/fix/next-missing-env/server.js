if (!process.env.API_BASE_URL) {
  console.error('Missing required environment variable: API_BASE_URL');
  process.exit(1);
}

console.log(`Using API: ${process.env.API_BASE_URL}`);
console.log(`Local: http://localhost:${process.env.PORT || 3000}`);
setInterval(() => {}, 10000);
