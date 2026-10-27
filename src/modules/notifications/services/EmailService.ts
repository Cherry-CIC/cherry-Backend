import { Resend } from 'resend';
import { emailConfig } from '../../../shared/config/emailConfig';

interface EmailResult {
  sent: boolean;
  skipped: boolean;
  emailId?: string;
}

interface SellerItemSoldEmailInput {
  to: string;
  sellerName?: string | null;
  productName: string;
  orderId: string;
  labelAttachment?: EmailAttachment;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  carrier?: string | null;
  idempotencyKey?: string;
}

interface BuyerShipmentStartedEmailInput {
  to: string;
  buyerName?: string | null;
  productName: string;
  orderId: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}

interface BuyerDeliveredEmailInput {
  to: string;
  buyerName?: string | null;
  productName: string;
  orderId: string;
}

interface TestEmailInput {
  to: string;
}

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  idempotencyKey?: string;
}

interface EmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

export class EmailService {
  private readonly resend =
    emailConfig.mode === 'live' && emailConfig.resendApiKey
      ? new Resend(emailConfig.resendApiKey)
      : null;

  isEnabled(): boolean {
    return emailConfig.mode === 'live';
  }

  async sendSellerItemSoldEmail(
    input: SellerItemSoldEmailInput,
  ): Promise<EmailResult> {
    const greeting = input.sellerName ? `Hi ${input.sellerName},` : 'Hi,';
    const trackingHtml = this.buildTrackingHtml(
      input.trackingUrl,
      input.trackingNumber,
    );
    const trackingText = this.buildTrackingText(
      input.trackingUrl,
      input.trackingNumber,
    );
    const shippingInstructions = input.labelAttachment
      ? {
          html: '<p>Your shipping QR code is attached. Show it when dropping off the parcel at an InPost point.</p>',
          text: [
            'Your shipping QR code is attached.',
            'Show it when dropping off the parcel at an InPost point.',
          ],
        }
      : {
          html: '<p>Your shipping QR code is being prepared. Please wait for it to arrive, then ship the parcel.</p>',
          text: [
            'Your shipping QR code is being prepared.',
            'Please wait for the QR code to arrive, then ship the parcel.',
          ],
        };

    return this.sendEmail({
      to: input.to,
      subject: `Your Cherry item sold: ${input.productName}`,
      html: `
        <p>${this.escapeHtml(greeting)}</p>
        <p>Your item has sold on Cherry.</p>
        <p><strong>${this.escapeHtml(input.productName)}</strong></p>
        ${shippingInstructions.html}
        <p>Order: ${this.escapeHtml(input.orderId)}</p>
        ${trackingHtml}
      `,
      text: [
        greeting,
        '',
        'Your item has sold on Cherry.',
        `Item: ${input.productName}`,
        ...shippingInstructions.text,
        `Order: ${input.orderId}`,
        trackingText,
      ]
        .filter(Boolean)
        .join('\n'),
      attachments: input.labelAttachment
        ? [input.labelAttachment]
        : undefined,
      idempotencyKey: `seller-label-${input.orderId}-${input.idempotencyKey ?? 'default'}`,
    });
  }

  async sendBuyerShipmentStartedEmail(
    input: BuyerShipmentStartedEmailInput,
  ): Promise<EmailResult> {
    const greeting = input.buyerName ? `Hi ${input.buyerName},` : 'Hi,';
    const trackingHtml = this.buildTrackingHtml(
      input.trackingUrl,
      input.trackingNumber,
    );
    const trackingText = this.buildTrackingText(
      input.trackingUrl,
      input.trackingNumber,
    );

    return this.sendEmail({
      to: input.to,
      subject: `Your Cherry order is confirmed: ${input.productName}`,
      html: `
        <p>${this.escapeHtml(greeting)}</p>
        <p>Your order is confirmed and the seller has been asked to ship your item.</p>
        <p><strong>${this.escapeHtml(input.productName)}</strong></p>
        <p>Order: ${this.escapeHtml(input.orderId)}</p>
        ${trackingHtml}
      `,
      text: [
        greeting,
        '',
        'Your order is confirmed and the seller has been asked to ship your item.',
        `Item: ${input.productName}`,
        `Order: ${input.orderId}`,
        trackingText,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  async sendBuyerDeliveredEmail(
    input: BuyerDeliveredEmailInput,
  ): Promise<EmailResult> {
    const greeting = input.buyerName ? `Hi ${input.buyerName},` : 'Hi,';

    return this.sendEmail({
      to: input.to,
      subject: `Your Cherry item was marked delivered: ${input.productName}`,
      html: `
        <p>${this.escapeHtml(greeting)}</p>
        <p>The courier has marked your item as delivered.</p>
        <p><strong>${this.escapeHtml(input.productName)}</strong></p>
        <p>Order: ${this.escapeHtml(input.orderId)}</p>
        <p>Please open the Cherry app to confirm you received it. If there is a problem, you can raise a dispute from the order screen.</p>
      `,
      text: [
        greeting,
        '',
        'The courier has marked your item as delivered.',
        `Item: ${input.productName}`,
        `Order: ${input.orderId}`,
        'Please open the Cherry app to confirm you received it. If there is a problem, you can raise a dispute from the order screen.',
      ].join('\n'),
    });
  }

  async sendTestEmail(input: TestEmailInput): Promise<EmailResult> {
    return this.sendEmail({
      to: input.to,
      subject: 'Cherry Resend test email',
      html: `
        <p>Resend is configured correctly for Cherry.</p>
        <p>If you can see this email, the backend can send through Resend.</p>
      `,
      text: [
        'Resend is configured correctly for Cherry.',
        'If you can see this email, the backend can send through Resend.',
      ].join('\n'),
    });
  }

  private async sendEmail(input: SendEmailInput): Promise<EmailResult> {
    if (emailConfig.mode !== 'live') {
      console.log(`Email skipped (${emailConfig.mode}): ${input.subject}`);
      return { sent: false, skipped: true };
    }

    if (!this.resend || !emailConfig.fromEmail) {
      throw new Error('Resend email is not configured');
    }

    const { idempotencyKey, attachments, ...payload } = input;
    const response = await this.resend.emails.send({
      from: emailConfig.fromEmail,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      attachments: attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        content_type: attachment.contentType ?? 'application/octet-stream',
      })),
    }, {
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    if (response.error) {
      throw new Error(
        `Resend email failed: ${response.error.name} - ${response.error.message}`,
      );
    }

    console.log(`Email sent via Resend: ${response.data.id}`);

    return { sent: true, skipped: false, emailId: response.data.id };
  }

  private buildTrackingHtml(
    trackingUrl?: string | null,
    trackingNumber?: string | null,
  ): string {
    if (trackingUrl) {
      return `<p><a href="${this.escapeAttribute(trackingUrl)}">Track delivery</a></p>`;
    }

    if (trackingNumber) {
      return `<p>Tracking number: ${this.escapeHtml(trackingNumber)}</p>`;
    }

    return '';
  }

  private buildTrackingText(
    trackingUrl?: string | null,
    trackingNumber?: string | null,
  ): string {
    if (trackingUrl) {
      return `Track delivery: ${trackingUrl}`;
    }

    if (trackingNumber) {
      return `Tracking number: ${trackingNumber}`;
    }

    return '';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value);
  }
}
