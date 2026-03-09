const fs = require('fs');

const file = 'index.html';
let content = fs.readFileSync(file, 'utf8');

const target = `
        // phyphox WiFi remote fetch
        async function fetchPhyphoxRemote(ip) {
          const phyphoxUrl = \`http://\${ip.trim()}/get?acc_time&accX&accY&accZ\`;
          const statusEl = document.getElementById('csv-status');
          statusEl.textContent = '取得中...'; statusEl.classList.remove('hidden');
          try {
            const res = await fetch(phyphoxUrl, { signal: AbortSignal.timeout(12000) });
            if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
            const json = await res.json();
            const t = json.acc_time.buffer;
            const x = json.accX.buffer;
            const y = json.accY.buffer;
            const z = json.accZ.buffer;
            if (!t || !t.length) throw new Error('データが空です。phyphox で計測を開始してください。');
            const lines = ['Time (s),Linear Acceleration x (m/s^2),Linear Acceleration y (m/s^2),Linear Acceleration z (m/s^2)'];
            for (let i = 0; i < t.length; i++) lines.push(\`\${t[i]},\${x[i]},\${y[i]},\${z[i]}\`);
            handleCSVText(lines.join('\\n'), 'phyphox WiFi');
            statusEl.textContent = '✗ 取得エラー: ' + err.message;
            const msg = \`phyphox に接続できません。\\nPCとスマホが同じWiFiに接続されていること、およびIPアドレス（\${ip.trim()}）が正しいことを確認してください。\`;
            showNotif(msg, true);
          }
  }`;

const replacement = `
        // phyphox WiFi remote fetch
        async function fetchPhyphoxRemote(rawIp) {
          // 不要なプレフィックスやポート指定を除去したIPアドレスを取得
          let ip = rawIp.trim().replace(/^https?:\\/\\//, '').replace(/:\\d+$/, '').replace(/\\/$/, '');
          const phyphoxUrl = \`http://\${ip}/get?acc_time&accX&accY&accZ\`;
          const statusEl = document.getElementById('csv-status');
          statusEl.textContent = '取得中...'; statusEl.classList.remove('hidden');
          try {
            const res = await fetch(phyphoxUrl, { signal: AbortSignal.timeout(12000) });
            if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
            const json = await res.json();
            const t = json.acc_time.buffer;
            const x = json.accX.buffer;
            const y = json.accY.buffer;
            const z = json.accZ.buffer;
            if (!t || !t.length) throw new Error('データが空です。phyphox で計測を開始してください。');
            const lines = ['Time (s),Linear Acceleration x (m/s^2),Linear Acceleration y (m/s^2),Linear Acceleration z (m/s^2)'];
            for (let i = 0; i < t.length; i++) lines.push(\`\${t[i]},\${x[i]},\${y[i]},\${z[i]}\`);
            handleCSVText(lines.join('\\n'), 'phyphox WiFi');
          } catch(err) {
            statusEl.textContent = '✗ 取得エラー: ' + err.message;
            const msg = \`phyphox に接続できません。\\nPCとスマホが同じWiFiに接続され、入力したアドレス（\${ip}）が正しいことを確認してください。\`;
            showNotif(msg, true);
          }
        }`;

if (!content.includes(target.trim())) {
  console.log("Target not found!");
  process.exit(1);
}

content = content.replace(target.trim(), replacement.trim());
fs.writeFileSync(file, content, 'utf8');
console.log("Patched index.html");
