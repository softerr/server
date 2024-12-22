import Head from "next/head";
import {BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Root from "./root";
import Quiz from "./quiz";

export default function Home() {
  return (
    <Router>
        <Routes>
          <Route path="/quiz/*" element={<Quiz/>} />
          <Route path="*" element={<Root/>} />
        </Routes>
    </Router>
  );
}
