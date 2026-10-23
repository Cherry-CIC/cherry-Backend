const mockSend = jest.fn();

jest.mock('../../../shared/config/emailConfig', () => ({
  emailConfig: {
    mode: 'live',
    resendApiKey: 're_test',
    fromEmail: 'Cherry <notifications@example.com>',
  },
}));

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

import { EmailService } from '../services/EmailService';

describe('EmailService.sendBuyerDeliveredEmail', () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation();
  const input = {
    to: 'buyer@example.com',
    buyerName: 'Jane',
    productName: 'Winter Coat',
    orderId: 'order-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  afterAll(() => logSpy.mockRestore());

  it('tells the buyer when the dispute window ends in UK time', async () => {
    await new EmailService().sendBuyerDeliveredEmail({
      ...input,
      disputeWindowEndsAt: new Date('2026-10-22T12:30:00.000Z'),
    });

    const sent = mockSend.mock.calls[0][0];
    expect(sent.text).toContain(
      'You have until 22 October 2026 at 13:30 (UK time)',
    );
    expect(sent.text).toContain('Confirming sends your donation on to the charity');
    expect(sent.text).toContain('a dispute can no longer be raised');
    expect(sent.html).toContain('22 October 2026 at 13:30 (UK time)');
  });

  it('keeps the original message when there is no hold', async () => {
    await new EmailService().sendBuyerDeliveredEmail(input);

    const sent = mockSend.mock.calls[0][0];
    expect(sent.text).toContain('Please open the Cherry app to confirm');
    expect(sent.text).not.toContain('You have until');
    expect(sent.html).not.toContain('You have until');
  });

  it('escapes the buyer-supplied product name', async () => {
    await new EmailService().sendBuyerDeliveredEmail({
      ...input,
      productName: '<script>alert(1)</script>',
      disputeWindowEndsAt: new Date('2026-10-22T12:30:00.000Z'),
    });

    expect(mockSend.mock.calls[0][0].html).not.toContain('<script>');
  });
});
