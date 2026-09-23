export interface UnitOfWork<TContext> {
  run<T>(work: (ctx: TContext) => Promise<T>): Promise<T>;
}
