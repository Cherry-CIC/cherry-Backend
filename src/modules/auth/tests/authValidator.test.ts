import { updateProfileSchema } from '../validators/authValidator';

describe('updateProfileSchema', () => {
  it('accepts an E.164 phone number', () => {
    const { error, value } = updateProfileSchema.validate({
      phoneNumber: '+447700900000',
    });

    expect(error).toBeUndefined();
    expect(value.phoneNumber).toBe('+447700900000');
  });

  it('rejects a phone number without the leading +', () => {
    const { error } = updateProfileSchema.validate({
      phoneNumber: '07700900000',
    });

    expect(error).toBeDefined();
    expect(error!.details[0].message).toContain('E.164');
  });

  it('rejects a phone number with non-digit characters', () => {
    const { error } = updateProfileSchema.validate({
      phoneNumber: '+44 7700 900000',
    });

    expect(error).toBeDefined();
  });

  it('rejects a phone number longer than 15 digits', () => {
    const { error } = updateProfileSchema.validate({
      phoneNumber: '+4477009000001234',
    });

    expect(error).toBeDefined();
  });

  it('accepts a partial update with only displayName', () => {
    const { error } = updateProfileSchema.validate({ displayName: 'John Smith' });

    expect(error).toBeUndefined();
  });

  it('rejects an empty body', () => {
    const { error } = updateProfileSchema.validate({});

    expect(error).toBeDefined();
  });

  it('rejects an invalid photoURL', () => {
    const { error } = updateProfileSchema.validate({ photoURL: 'not-a-url' });

    expect(error).toBeDefined();
  });

  it('strips email and address so they cannot be updated here', () => {
    const { error, value } = updateProfileSchema.validate(
      {
        displayName: 'John Smith',
        email: 'someone-else@example.com',
        address: { city: 'London' },
      },
      { stripUnknown: true }
    );

    expect(error).toBeUndefined();
    expect(value.email).toBeUndefined();
    expect(value.address).toBeUndefined();
  });
});
