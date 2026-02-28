export interface LNBitsConfig {
  url: string;
  adminKey: string;
  invoiceKey: string;
}

export interface Invoice {
  paymentHash: string;
  bolt11: string;
}

interface LNBitsInvoiceResponse {
  payment_hash: string;
  payment_request: string;
}

interface LNBitsPaymentStatus {
  paid: boolean;
}

interface LNBitsPayResponse {
  payment_hash: string;
}

interface LNBitsWithdrawResponse {
  lnurl: string;
}

export class LNBitsClient {
  private config: LNBitsConfig;

  constructor(config: LNBitsConfig) {
    this.config = config;
  }

  async createInvoice(amount: number, memo: string): Promise<Invoice> {
    const res = await fetch(`${this.config.url}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.config.invoiceKey,
      },
      body: JSON.stringify({
        out: false,
        amount,
        memo,
        expiry: 600,
      }),
    });

    if (!res.ok) {
      throw new Error(`LNBits invoice creation failed: ${res.status}`);
    }

    const data = (await res.json()) as LNBitsInvoiceResponse;
    return {
      paymentHash: data.payment_hash,
      bolt11: data.payment_request,
    };
  }

  async checkPayment(paymentHash: string): Promise<boolean> {
    const res = await fetch(`${this.config.url}/api/v1/payments/${paymentHash}`, {
      headers: {
        'X-Api-Key': this.config.invoiceKey,
      },
    });

    if (!res.ok) return false;

    const data = (await res.json()) as LNBitsPaymentStatus;
    return data.paid === true;
  }

  async payInvoice(bolt11: string): Promise<string> {
    const res = await fetch(`${this.config.url}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.config.adminKey,
      },
      body: JSON.stringify({
        out: true,
        bolt11,
      }),
    });

    if (!res.ok) {
      throw new Error(`LNBits payment failed: ${res.status}`);
    }

    const data = (await res.json()) as LNBitsPayResponse;
    return data.payment_hash;
  }

  async createLnurlWithdraw(amount: number, memo: string): Promise<string> {
    const res = await fetch(`${this.config.url}/withdraw/api/v1/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.config.adminKey,
      },
      body: JSON.stringify({
        title: memo,
        min_withdrawable: amount,
        max_withdrawable: amount,
        uses: 1,
        wait_time: 1,
        is_unique: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`LNBits LNURL-withdraw creation failed: ${res.status}`);
    }

    const data = (await res.json()) as LNBitsWithdrawResponse;
    return data.lnurl;
  }
}
