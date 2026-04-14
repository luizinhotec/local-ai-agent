const { generateWallet } = require('@stacks/wallet-sdk');
const words = process.argv[2];
if (!words) { console.error('Uso: node gerar-chave.cjs "palavra1 palavra2 ... palavra24"'); process.exit(1); }
generateWallet({ secretKey: words, password: '' }).then(w => {
  console.log('Chave privada:', w.accounts[0].stxPrivateKey);
  console.log('Endereco:', w.accounts[0].address);
}).catch(e => console.error('Erro:', e.message));
