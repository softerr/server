import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import NotFound from "./quiz/layouts/NotFound";
import QuizApp from "./quiz"
import { userRefreshToken } from "./user/services";

const App = () => {
    const dispatch = useDispatch();

    useEffect(() => {
        return userRefreshToken(
            data => dispatch({ type: "SIGN_IN", token: data.token }),
            () => { }
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
