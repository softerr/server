import { Route, Routes } from "react-router-dom";
import { Fragment, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import myFetch from "./../hooks/myFetch";
import MyNavbar from "./components/common/Navbar";
import Login from "./components/user/Login";
import Signup from "./components/user/Signup";
import ActivateAccount from "./components/user/ActivateAccount";
import ForgotPassword from "./components/user/ForgotPassword";
import ResetPassword from "./components/user/ResetPassword";
import Explore from "./components/explore/Explore";
import Library from "./components/library/Library";
import LibraryQuizEdit from "./components/library/LibraryQuizEdit";
import LibraryQuestionEdit from "./components/library/LibraryQuestionEdit";
import Review from "./components/review/Review";
import ReviewQuiz from "./components/review/ReviewQuiz";
import Users from "./components/admin/Users";
import UserEdit from "./components/admin/UserEdit";
import Quiz from "./components/game/Quiz";
import GameQuiz from "./components/game/GameQuiz";
import Results from "./components/game/Results";

const QuizApp = () => {
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
            <Fragment>
                <MyNavbar />
                <Routes>
                    <Route path="/" element={user.roles ? <Explore /> : <Login />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/activate/:token" element={<ActivateAccount />} />
                    <Route path="/forgot_password" element={<ForgotPassword />} />
                    <Route path="/reset_password/:token" element={<ResetPassword />} />
                    {user.roles && (
                        <Fragment>
                            <Route path="/library" element={<Library />} />
                            <Route path="/library/create" element={<LibraryQuizEdit />} />
                            <Route path="/library/:quizId/edit" element={<LibraryQuizEdit />} />
                            <Route path="/library/:quizId/questions/create" element={<LibraryQuestionEdit />} />
                            <Route path="/library/:quizId/questions/:questionId/edit" element={<LibraryQuestionEdit />} />
                            <Route path="/quizzes/:quizId" element={<Quiz />} />
                            <Route path="/quizzes/:quizId/games/:gameId" element={<GameQuiz />} />
                            <Route path="/quizzes/:quizId/games/:gameId/results" element={<Results />} />
                            <Route path="/review" element={<Review />} />
                            <Route path="/review/:quizId" element={<ReviewQuiz />} />
                            <Route path="/users" element={<Users />} />
                            <Route path="/users/:userId/edit" element={<UserEdit />} />
                        </Fragment>
                    )}
                </Routes>
            </Fragment>
        );
}

export default QuizApp;