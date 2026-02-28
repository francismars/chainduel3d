import QRCode from 'qrcode';

export class ResultUI {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async show(winnerName: string, top3Names: string[], amount: number, lnurl: string | null, onContinue: () => void) {
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      width: 100%; height: 100%; background: #0a0a0a;
      font-family: 'Courier New', monospace; color: #f7931a;
    `;

    // Trophy / winner announcement
    const trophy = document.createElement('div');
    trophy.textContent = '₿';
    trophy.style.cssText = `
      font-size: 100px; margin-bottom: 10px;
      text-shadow: 0 0 60px rgba(247,147,26,0.8);
      animation: winPulse 1s ease-in-out infinite;
    `;
    wrapper.appendChild(trophy);

    const winText = document.createElement('h1');
    winText.textContent = `${winnerName.toUpperCase()} WINS!`;
    winText.style.cssText = `
      font-size: 48px; margin: 0 0 16px 0; color: #fff;
      text-shadow: 0 0 30px rgba(247,147,26,0.5);
    `;
    wrapper.appendChild(winText);

    const amountText = document.createElement('div');
    amountText.textContent = `${Math.floor(amount).toLocaleString()} sats`;
    amountText.style.cssText = 'font-size: 28px; color: #00ff88; margin-bottom: 30px;';
    wrapper.appendChild(amountText);

    if (top3Names.length > 0) {
      const podium = document.createElement('div');
      podium.style.cssText = `
        margin-bottom: 18px; padding: 10px 16px;
        border: 1px solid #2c2c2c; border-radius: 6px;
        background: rgba(15,15,15,0.85); color: #dcdcdc;
        min-width: 320px; text-align: left; font-size: 13px; line-height: 1.8;
      `;
      const p1 = top3Names[0] ?? '---';
      const p2 = top3Names[1] ?? '---';
      const p3 = top3Names[2] ?? '---';
      podium.innerHTML = `
        <div style="color:#fff;letter-spacing:1px;margin-bottom:4px">TOP 3</div>
        <div>1. ${p1}</div>
        <div>2. ${p2}</div>
        <div>3. ${p3}</div>
      `;
      wrapper.appendChild(podium);
    }

    // QR code for withdrawal (if lnurl provided)
    if (lnurl) {
      const qrLabel = document.createElement('div');
      qrLabel.textContent = 'SCAN TO WITHDRAW';
      qrLabel.style.cssText = 'font-size: 14px; color: #888; margin-bottom: 10px;';
      wrapper.appendChild(qrLabel);

      const qrCanvas = document.createElement('canvas');
      try {
        await QRCode.toCanvas(qrCanvas, lnurl, {
          width: 250,
          color: { dark: '#00ff88', light: '#0a0a0a' },
        });
      } catch { /* skip if QR fails */ }
      wrapper.appendChild(qrCanvas);

      const lnurlText = document.createElement('div');
      lnurlText.textContent = lnurl.substring(0, 40) + '...';
      lnurlText.style.cssText = `
        font-size: 10px; color: #555; margin-top: 8px; cursor: pointer;
        max-width: 300px; text-align: center; word-break: break-all;
      `;
      lnurlText.onclick = () => {
        navigator.clipboard.writeText(lnurl);
        lnurlText.textContent = 'Copied!';
      };
      wrapper.appendChild(lnurlText);
    }

    // Continue button
    const continueBtn = document.createElement('button');
    continueBtn.textContent = 'CHAIN RACE AGAIN';
    continueBtn.style.cssText = `
      margin-top: 30px; padding: 14px 40px;
      background: linear-gradient(135deg, #f7931a, #e67e00);
      border: none; border-radius: 4px; color: #000; font-weight: bold;
      font-family: 'Courier New', monospace; font-size: 16px;
      cursor: pointer; letter-spacing: 2px;
    `;
    continueBtn.onclick = onContinue;
    wrapper.appendChild(continueBtn);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes winPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
    `;
    wrapper.appendChild(style);

    this.container.appendChild(wrapper);
  }
}
