import { Route, Routes } from "react-router-dom";
import { BrowserRouter as Router } from "react-router-dom";
import NotFound from "./quiz/components/common/NotFound";
import QuizApp from "./quiz"

const App = () => {
    return (
        <div className="App">
            <Router>
                <Routes>
                    <Route path="/quiz/*" element={<QuizApp />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </Router>
        </div>
    );
};

export default App;
