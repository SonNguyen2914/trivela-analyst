import type { AppProps } from "next/app";
import Head from "next/head";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Trivela Analyst</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="An AI soccer analyst that explains Trivela's match predictions, and proves every number it says." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Inter+Tight:wght@400;600;700&family=JetBrains+Mono&display=swap" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
