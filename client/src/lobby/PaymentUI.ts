import QRCode from 'qrcode';

interface PaymentData {
  sessionId: string;
  invoices: {
    player1: { bolt11: string; paymentHash: string };
    player2: { bolt11: string; paymentHash: string };
  };
}
const UI_FONT_FAMILY = "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

export class PaymentUI {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async show(data: PaymentData): Promise<boolean> {
    return new Promise(async (resolve) => {
      this.container.innerHTML = '';
      const compactLayout = window.innerHeight < 860;
      const narrowLayout = window.innerWidth < 900;

      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        display: flex; flex-direction: column; align-items: center; justify-content: ${compactLayout ? 'flex-start' : 'center'};
        width: 100%; height: 100%; background: #0a0a0a;
        font-family: ${UI_FONT_FAMILY}; color: #f7931a;
        overflow: auto; padding: ${compactLayout ? '10px 10px 16px' : '18px 14px 24px'}; box-sizing: border-box;
      `;

      const title = document.createElement('h2');
      title.textContent = 'DEPOSIT SATS';
      title.style.cssText = `font-size: clamp(26px, 6vw, 36px); margin-bottom: ${compactLayout ? '10px' : '20px'}; letter-spacing: 4px; text-align: center;`;
      wrapper.appendChild(title);

      const row = document.createElement('div');
      row.style.cssText = `display: grid; grid-template-columns: ${narrowLayout ? '1fr' : '1fr 1fr'}; gap: ${compactLayout ? '10px' : '20px'}; width: min(920px, 96vw);`;

      const players = [
        { label: 'PLAYER 1', invoice: data.invoices.player1 },
        { label: 'PLAYER 2', invoice: data.invoices.player2 },
      ];

      const statusEls: HTMLElement[] = [];

      for (const player of players) {
        const col = document.createElement('div');
        col.style.cssText = `
          display: flex; flex-direction: column; align-items: center;
          background: rgba(20,20,30,0.9); border: 1px solid #333;
          border-radius: 8px; padding: ${compactLayout ? '14px' : '20px'};
        `;

        const label = document.createElement('div');
        label.textContent = player.label;
        label.style.cssText = 'font-size: 18px; margin-bottom: 12px; color: #fff;';
        col.appendChild(label);

        const qrCanvas = document.createElement('canvas');
        qrCanvas.style.cssText = 'border-radius: 4px;';
        try {
          await QRCode.toCanvas(qrCanvas, player.invoice.bolt11, {
            width: 200,
            color: { dark: '#f7931a', light: '#0a0a0a' },
          });
        } catch {
          qrCanvas.width = 200;
          qrCanvas.height = 200;
          const ctx = qrCanvas.getContext('2d')!;
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(0, 0, 200, 200);
          ctx.fillStyle = '#f7931a';
          ctx.font = '14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('QR Error', 100, 100);
        }
        col.appendChild(qrCanvas);

        const bolt11 = document.createElement('div');
        bolt11.textContent = player.invoice.bolt11.substring(0, 30) + '...';
        bolt11.style.cssText = `
          font-size: 10px; color: #555; margin-top: 8px; cursor: pointer;
          word-break: break-all; max-width: 200px; text-align: center;
        `;
        bolt11.title = 'Click to copy';
        bolt11.onclick = () => {
          navigator.clipboard.writeText(player.invoice.bolt11);
          bolt11.textContent = 'Copied!';
          setTimeout(() => {
            bolt11.textContent = player.invoice.bolt11.substring(0, 30) + '...';
          }, 1500);
        };
        col.appendChild(bolt11);

        const status = document.createElement('div');
        status.textContent = 'Waiting for payment...';
        status.style.cssText = 'margin-top: 12px; font-size: 13px; color: #888;';
        col.appendChild(status);
        statusEls.push(status);

        row.appendChild(col);
      }

      wrapper.appendChild(row);

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'CANCEL';
      cancelBtn.style.cssText = `
        margin-top: ${compactLayout ? '12px' : '24px'}; padding: 10px 30px; background: transparent;
        border: 1px solid #555; border-radius: 4px; color: #888;
        font-family: ${UI_FONT_FAMILY}; cursor: pointer;
      `;
      cancelBtn.onclick = () => resolve(false);
      wrapper.appendChild(cancelBtn);

      this.container.appendChild(wrapper);

      // Poll for payment status
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/sessions/${data.sessionId}`);
          if (!res.ok) return;
          const session = await res.json();

          for (let i = 0; i < 2; i++) {
            if (session.session.players[i].depositPaid) {
              statusEls[i].textContent = 'PAID';
              statusEls[i].style.color = '#00ff88';
            }
          }

          if (session.session.status === 'deposits_confirmed') {
            clearInterval(pollInterval);
            resolve(true);
          }
        } catch { /* ignore polling errors */ }
      }, 2000);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        resolve(false);
      }, 300_000);
    });
  }
}
