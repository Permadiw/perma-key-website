PERMA KEY WEBSITE — SETUP

FILES
- admin.html: admin dashboard (generate FREE/PREMIUM, list, activate, revoke)
- free-key.html: task flow sequential Subscribe -> Like -> Watch -> Comment, 30-second timer, GET KEY and copy button

API configured in both pages:
https://perma-key-api.herdiansyah0239.workers.dev

IMPORTANT BEFORE DEPLOY
1. In free-key.html, replace TASK_URLS with your actual YouTube channel and video URLs.
2. The task timers do NOT verify real subscribe/like/watch/comment activity. Current API /public/get-key has been understood to issue a key via POST without real task verification. This is not a secure task gate. Do not claim genuine task verification until a real server-side verification/postback system is implemented.
3. admin.html asks for ADMIN_TOKEN at runtime; it is not hardcoded into the file. However, token is still sent from the browser to the Worker. For public/production use, the safer design is a server-side authenticated admin proxy/session; never commit your token to GitHub or embed it in public JavaScript.
4. Both pages need the Worker to allow CORS for the deployed site origin. If browser requests fail with CORS, configure CORS on the Worker for the exact Pages domain, not by exposing any secret.
5. Endpoint response fields are handled defensively but may need adjustment to match the exact Worker JSON response.

DEPLOY WITH CLOUDFLARE PAGES (Android)
1. Open https://dash.cloudflare.com/ and sign in.
2. Go to Workers & Pages -> Create -> Pages (static upload flow; interface labels may vary).
3. Create a project, e.g. perma-key-portal, and upload these HTML files as static assets. For easy URLs, make separate Pages projects or rename copies to index.html in separate folders/projects.
4. Cloudflare Pages will provide the actual website URL after successful deployment. The URL cannot be known until you deploy it.
5. Test the FREE page and admin page. Keep admin page private; do not share it publicly unless you implement stronger authentication.

To have clean URLs /admin and /free-key, use separate Pages projects or configure routing/redirects after initial testing.
