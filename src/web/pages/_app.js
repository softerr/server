import "@/styles/globals.css";
import {useEffect, useState} from 'react';

export default function App({ Component, pageProps }) {
  const [render, setRender] = useState(false);
  useEffect(() => setRender(true), []);
  return render ? <Component {...pageProps} /> : null;
}
