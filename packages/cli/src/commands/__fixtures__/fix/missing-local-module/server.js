const { getMessage } = require('./message.js');

console.log(getMessage());
console.log(`Local: http://localhost:${process.env.PORT || 3000}`);
setInterval(() => {}, 10000);
