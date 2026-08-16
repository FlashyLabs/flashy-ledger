/** Same shape as FlashyOS's AppError, so routes fronting this service map errors identically. */
export class LedgerError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}
