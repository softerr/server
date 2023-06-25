import { Route, Routes } from "react-router-dom";
import { Fragment, useEffect } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import myFetch from "./hooks/myFetch";
import MyNavbar from "./Components/Common/Navbar";
import NotFound from "./Components/Common/NotFound";
import Login from "./Components/User/Login";
import Signup from "./Components/User/Signup";
import ActivateAccount from "./Components/User/ActivateAccount";
import ForgotPassword from "./Components/User/ForgotPassword";
import ResetPassword from "./Components/User/ResetPassword";
import Explore from "./Components/Explore/Explore";
import Library from "./Components/Library/Library";
import LibraryQuizEdit from "./Components/Library/LibraryQuizEdit";
import LibraryQuestionEdit from "./Components/Library/LibraryQuestionEdit";
import Review from "./Components/Review/Review";
import ReviewQuiz from "./Components/Review/ReviewQuiz";
import Users from "./Components/Admin/Users";
import UserEdit from "./Components/Admin/UserEdit";
import Quiz from "./Components/Game/Quiz";
import GameQuiz from "./Components/Game/GameQuiz";
import Results from "./Components/Game/Results";

const App = () => {
    const dispatch = useDispatch();
    const user = useSelector(state => state.user);

    useEffect(() => {
        return myFetch(
            "/api/quiz/refresh",
            "POST",
            undefined,
            undefined,
            data => {
                dispatch({ type: "SIGN_IN", token: data.token });
            },
            () => {},
            () => {}
        );
    }, []);

    return (
        <div className="App">
            <Router>
                <MyNavbar />
                <Routes>
                    <Route path="/quiz" element={user.roles ? <Explore /> : <Login />} />
                    <Route path="/quiz/login" element={<Login />} />
                    <Route path="/quiz/signup" element={<Signup />} />
                    <Route path="/quiz/activate/:token" element={<ActivateAccount />} />
                    <Route path="/quiz/forgot_password" element={<ForgotPassword />} />
                    <Route path="/quiz/reset_password/:token" element={<ResetPassword />} />
                    {user.roles && (
                        <Fragment>
                            <Route path="/quiz/library" element={<Library />} />
                            <Route path="/quiz/library/create" element={<LibraryQuizEdit />} />
                            <Route path="/quiz/library/:quizId/edit" element={<LibraryQuizEdit />} />
                            <Route path="/quiz/library/:quizId/questions/create" element={<LibraryQuestionEdit />} />
                            <Route path="/quiz/library/:quizId/questions/:questionId/edit" element={<LibraryQuestionEdit />} />
                            <Route path="/quiz/quizzes/:quizId" element={<Quiz />} />
                            <Route path="/quiz/quizzes/:quizId/games/:gameId" element={<GameQuiz />} />
                            <Route path="/quiz/quizzes/:quizId/games/:gameId/results" element={<Results />} />
                            <Route path="/quiz/review" element={<Review />} />
                            <Route path="/quiz/review/:quizId" element={<ReviewQuiz />} />
                            <Route path="/quiz/users" element={<Users />} />
                            <Route path="/quiz/users/:userId/edit" element={<UserEdit />} />
                        </Fragment>
                    )}
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </Router>
        </div>
    );
};

export default App;
