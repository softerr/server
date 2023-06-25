import { useParams } from "react-router-dom";
import { Fragment, useEffect, useState } from "react";
import { Button, Container } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import myFetch from "../../hooks/myFetch";

const Quiz = () => {
    const cachedUser = useSelector(state => state.user);
    const cachedPublicQuizzes = useSelector(state => state.publicQuizzes);
    const [quiz, setQuiz] = useState();
    const { _, quizId } = useParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();

    const handlePlay = e => {
        myFetch(
            `/api/quiz/quizzes/${quizId}/games`,
            "POST",
            cachedUser.token,
            {},
            data => {
                navigate(`/quiz/quizzes/${quizId}/games/${data.id}`, { state: { gameQuiz: data } });
            },
            res => {
                if (res.status === 401) {
                    dispatch({ type: "SIGN_OUT" });
                    navigate("/quiz/login");
                } else {
                    console.log(res);
                }
            }
        );
    };

    useEffect(() => {
        if (cachedPublicQuizzes.quizzes && cachedPublicQuizzes.quizzes.length > 0) {
            setQuiz(cachedPublicQuizzes.quizzes.find(quiz => quiz.id === parseInt(quizId, 10)));
        }
    }, []);

    return (
        <Container className="content px-3" style={{ maxWidth: "576px" }}>
            <Button style={{ marginBottom: "50px" }} as={Link} to={`/quiz/`}>
                Back
            </Button>
            {quiz && (
                <Fragment>
                    <h1>{quiz.name}</h1>
                    <h4>{quiz.description}</h4>
                    <p>
                        {quiz.question_count} {quiz.question_count === 1 ? "question" : "questions"}
                        <br />
                        {quiz.games} {quiz.games === 1 ? "play" : "plays"}
                    </p>
                    <div className="d-grid">
                        <Button variant="primary" onClick={handlePlay} style={{ minWidth: "280px", marginTop: "50px" }}>
                            Play
                        </Button>
                    </div>
                </Fragment>
            )}
        </Container>
    );
};

export default Quiz;
