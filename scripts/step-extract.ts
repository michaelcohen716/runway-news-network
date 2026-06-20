/**
 * Step 1 dev script: `npm run step:extract -- <url>`
 * Prints the cleaned article as JSON (body truncated for readability).
 */
import { extractArticle } from "@/lib/extract";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: npm run step:extract -- <url>");
    process.exit(1);
  }
  const article = await extractArticle(url);
  console.log(
    JSON.stringify(
      {
        ...article,
        bodyChars: article.body.length,
        body: article.body.slice(0, 400) + (article.body.length > 400 ? " …" : ""),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("extraction error:", err.message);
  process.exit(1);
});
