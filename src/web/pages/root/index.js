import Head from "next/head";
import {BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

export default function Root() {
  return (
    <>
      <Head>
        <title>Root</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div>
        <ul>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li>
            <Link to="/about">About</Link>
          </li>
          <li>
            <Link to="/quiz">Quiz</Link>
          </li>
        </ul>

        <Routes>
          <Route path="/" element={<h1>Root Home</h1>} />
          <Route path="/about" element={<h1>Root About</h1>} />
        </Routes>
      </div>
    </>
  );
}
