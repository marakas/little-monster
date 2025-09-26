// types/page-like.ts
export interface PageLike {
  bringToFront(): Promise<void>;
  goto(url: string, opts?: any): Promise<any>;
  waitForSelector(selector: string, opts?: any): Promise<any>;
  evaluate<T = any>(
    fn: (...args: any[]) => T | Promise<T>,
    arg?: any
  ): Promise<T>;
  title(): Promise<string>;
  on(event: string, handler: (...args: any[]) => void): void;
}
