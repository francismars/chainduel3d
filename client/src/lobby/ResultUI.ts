import type { GameMode, RaceItemStats } from 'shared/types';
import QRCode from 'qrcode';
const UI_FONT_FAMILY = "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

export class ResultUI {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async show(
    winnerName: string,
    top3Names: string[],
    amount: number,
    lnurl: string | null,
    onContinue: () => void,
    mode: GameMode = 'classic',
    itemStats: RaceItemStats[] = [],
    playerNames: string[] = [],
  ) {
    this.container.innerHTML = '';
    const compactLayout = window.innerHeight < 860;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display: flex; flex-direction: column; align-items: center; justify-content: ${compactLayout ? 'flex-start' : 'center'};
      width: 100%; height: 100%; background: radial-gradient(circle at center,#080808 0%,#000 70%);
      font-family: ${UI_FONT_FAMILY}; color: #e9e9e9;
      overflow: auto; padding: ${compactLayout ? '10px 10px 16px' : '18px 14px 24px'}; box-sizing: border-box;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      width:min(640px,94vw);background:#090909;border:1px solid #2b2b2b;border-radius:10px;
      padding:${compactLayout ? '16px' : '24px'};box-shadow:0 0 26px rgba(255,255,255,0.08);
      display:flex;flex-direction:column;align-items:center;
    `;
    wrapper.appendChild(card);

    // Trophy / winner announcement
    const trophy = document.createElement('div');
    trophy.textContent = mode === 'derby' ? '◆' : '₿';
    trophy.style.cssText = `
      font-size: clamp(52px, 11vw, 82px); margin-bottom: 8px; color:#efefef;
      text-shadow: 0 0 36px rgba(255,255,255,0.32);
      animation: winPulse 1.6s ease-in-out infinite;
    `;
    card.appendChild(trophy);

    const winText = document.createElement('h1');
    winText.textContent = mode === 'derby'
      ? `${winnerName.toUpperCase()} SURVIVES!`
      : `${winnerName.toUpperCase()} WINS!`;
    winText.style.cssText = `
      font-size: clamp(24px, 6vw, 44px); margin: 0 0 ${compactLayout ? '10px' : '14px'} 0; color: #fff;
      text-shadow: 0 0 24px rgba(255,255,255,0.15);
      text-align: center;
      letter-spacing: 1.2px;
    `;
    card.appendChild(winText);

    const amountText = document.createElement('div');
    amountText.textContent = `${Math.floor(amount).toLocaleString()} sats`;
    amountText.style.cssText = `font-size: clamp(18px, 4.8vw, 26px); color: #d7ffd7; margin-bottom: ${compactLayout ? '14px' : '22px'};`;
    card.appendChild(amountText);

    if (top3Names.length > 0) {
      const podium = document.createElement('div');
      podium.style.cssText = `
        margin-bottom: ${compactLayout ? '12px' : '18px'}; padding: 10px 16px;
        border: 1px solid #2c2c2c; border-radius: 6px;
        background: rgba(10,10,10,0.9); color: #dcdcdc;
        min-width: min(320px, 90vw); text-align: left; font-size: 13px; line-height: 1.8;
      `;
      const p1 = top3Names[0] ?? '---';
      const p2 = top3Names[1] ?? '---';
      const p3 = top3Names[2] ?? '---';
      podium.innerHTML = `
        <div style="color:#fff;letter-spacing:1px;margin-bottom:4px">${mode === 'derby' ? 'SURVIVOR ORDER' : 'TOP 3'}</div>
        <div>1. ${p1}</div>
        <div>2. ${p2}</div>
        <div>3. ${p3}</div>
      `;
      card.appendChild(podium);
    }

    if (itemStats.length > 0) {
      const statsWrap = document.createElement('div');
      statsWrap.style.cssText = `
        margin-bottom:${compactLayout ? '12px' : '18px'};
        padding:10px 12px;border:1px solid #2c2c2c;border-radius:6px;
        background:rgba(10,10,10,0.9);width:min(560px,90vw);
      `;
      const title = document.createElement('div');
      title.textContent = 'ITEM STATS';
      title.style.cssText = 'color:#fff;letter-spacing:1px;font-size:12px;margin-bottom:6px;';
      statsWrap.appendChild(title);
      const rows = [...itemStats].sort((a, b) => a.playerIndex - b.playerIndex);
      const body = document.createElement('div');
      body.style.cssText = 'display:grid;grid-template-columns:1.4fr .7fr .7fr .9fr .8fr .8fr;gap:6px;font-size:11px;color:#d6d6d6;';
      const header = ['RIDER', 'PICK', 'USE', 'EFF', 'HIT', 'DENY'];
      for (const col of header) {
        const cell = document.createElement('div');
        cell.textContent = col;
        cell.style.cssText = 'color:#9f9f9f;font-size:10px;letter-spacing:0.6px;border-bottom:1px solid #252525;padding-bottom:3px;';
        body.appendChild(cell);
      }
      for (const row of rows) {
        const eff = row.uses > 0 ? `${Math.round((row.hitsLanded / row.uses) * 100)}%` : '--';
        const rider = playerNames[row.playerIndex] ?? `P${row.playerIndex + 1}`;
        const cells = [
          rider,
          String(row.pickups),
          String(row.uses),
          eff,
          String(row.hitsLanded),
          String(row.denied),
        ];
        for (const text of cells) {
          const cell = document.createElement('div');
          cell.textContent = text;
          cell.style.cssText = 'padding:2px 0;border-bottom:1px solid #191919;';
          body.appendChild(cell);
        }
      }
      statsWrap.appendChild(body);
      card.appendChild(statsWrap);
    }

    // QR code for withdrawal (if lnurl provided)
    if (lnurl) {
      const qrLabel = document.createElement('div');
      qrLabel.textContent = 'SCAN TO WITHDRAW';
      qrLabel.style.cssText = 'font-size: 12px; color: #9f9f9f; margin-bottom: 10px; letter-spacing:0.8px;';
      card.appendChild(qrLabel);

      const qrCanvas = document.createElement('canvas');
      try {
        await QRCode.toCanvas(qrCanvas, lnurl, {
          width: 250,
          color: { dark: '#f0f0f0', light: '#0a0a0a' },
        });
      } catch { /* skip if QR fails */ }
      card.appendChild(qrCanvas);

      const lnurlText = document.createElement('div');
      lnurlText.textContent = lnurl.substring(0, 40) + '...';
      lnurlText.style.cssText = `
        font-size: 10px; color: #7b7b7b; margin-top: 8px; cursor: pointer;
        max-width: 300px; text-align: center; word-break: break-all;
      `;
      lnurlText.onclick = () => {
        navigator.clipboard.writeText(lnurl);
        lnurlText.textContent = 'Copied!';
      };
      card.appendChild(lnurlText);
    }

    // Continue button
    const continueBtn = document.createElement('button');
    continueBtn.textContent = mode === 'derby' ? 'DERBY AGAIN' : 'DUEL AGAIN';
    continueBtn.style.cssText = `
      margin-top: ${compactLayout ? '16px' : '30px'}; padding: ${compactLayout ? '11px 28px' : '14px 40px'};
      background: linear-gradient(135deg, #efefef, #cdcdcd);
      border: 1px solid #efefef; border-radius: 4px; color: #000; font-weight: bold;
      font-family: ${UI_FONT_FAMILY}; font-size: 16px;
      cursor: pointer; letter-spacing: 1.8px;
    `;
    continueBtn.onclick = onContinue;
    card.appendChild(continueBtn);

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
