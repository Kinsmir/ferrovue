const HOST = "ferrovue.invalid";
const BASE = `https://${HOST}/`;

/** Whether a browser following `href` from a page of this site leaves the site: `//host`, `/\host`,
 * `/<tab>/host` and a URL with a scheme do. */
export function otherHost(href: string): boolean {
  try {
    return new URL(href, BASE).host !== HOST;
  } catch {
    return true;
  }
}

/** The error a navigation to another host fails with. */
export function otherHostError(href: string): Error {
  return new Error(`ferrovue: a link to ${JSON.stringify(href)} leads to another host as the browser reads it, so it is not handed to navigate: build the link from a named route or an absolute path of this site`);
}
