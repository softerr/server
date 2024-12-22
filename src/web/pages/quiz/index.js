import Head from "next/head";
import {BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

export default function Quiz() {
  return (
    <>
      <Head>
        <title>Quiz</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div>
        <ul>
          <li>
            <Link to="/quiz">Home</Link>
          </li>
          <li>
            <Link to="/quiz/about">About</Link>
          </li>
        </ul>

        <Routes>
          <Route path="/about" element={<h1>Quiz About</h1>} />
          <Route path="/" element={<h1>Quiz Home</h1>} />
        </Routes>
      </div>
    </>
  );
}
