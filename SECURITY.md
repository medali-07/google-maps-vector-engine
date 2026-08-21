# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| 0.x     | No        |

## Reporting a vulnerability

Report privately through
[GitHub's security advisory form](https://github.com/medali-07/google-maps-vector-engine/security/advisories/new).
Please do not open a public issue for a vulnerability.

Include what the issue is, how to reproduce it, and what an attacker could do
with it. A proof of concept helps but is not required.

Expect an acknowledgement within a week. If a fix is warranted it will ship in
a patch release, with an advisory published once it is available.

## Scope

This library renders vector tiles a consumer supplies onto a Google Map. The
things worth thinking about:

- **Tile data is untrusted input.** It is decoded with `@mapbox/vector-tile`
  and drawn to a canvas; it is never evaluated. A malformed tile should fail
  the tile, not the page. If you can make one crash or hang the browser, that
  is in scope.
- **Feature properties reach the DOM only if you put them there.** The library
  does not write them into HTML. Doing so in your own click handler without
  escaping is an XSS in your application, not here — the examples use
  `textContent` for this reason.
- **Tile URLs are yours.** The library substitutes `{z}`, `{x}` and `{y}` into
  the template you supply and fetches the result. It does not fetch anything
  else, and `{x}` is wrapped into the valid range so it cannot be steered out
  of it.

Out of scope: vulnerabilities in Google Maps itself, and anything requiring a
consumer to pass attacker-controlled configuration into the constructor.
