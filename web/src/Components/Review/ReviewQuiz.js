import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import myFetch from "../../hooks/myFetch";
import { Button, Col, Container, Row } from "react-bootstrap";
import QuestionCard from "../Common/QuestionCard";

const ReviewQuiz = () => {
    const cachedUser = useSelector(state => state.user);
    const cachedQuestions = useSelector(state => state.questions);
    const [{ questions, loading, error }, setState] = useState({});
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { quizId } = useParams();
    const location = useLocation();

    useEffect(() => {
        if (cachedQuestions.questions[quizId] && cachedQuestions.questions[quizId].length > 0) {
            setState({ questions: cachedQuestions.questions[quizId], loading: false, error: null });
            return;
        }
        setState({ loading: true, error: null });
        return myFetch(
            `/api/quiz/modquizzes/${quizId}/questions`,
            "GET",
            cachedUser.token,
            undefined,
            data => {
                setState({ questions: data, loading: false, error: null });
                dispatch({ type: "QUESTIONS_SET", quizId: quizId, questions: data });
            },
            res => {
                setState({ loading: false, error: res });
            },
            msg => {
                setState({ loading: false, error: msg });
            }
        );
    }, [quizId]);

    const setStatus = status => {
        myFetch(
            `/api/quiz/modquizzes/${quizId}`,
            "PATCH",
            cachedUser.token,
            { status: status },
            data => {
                dispatch({ type: "MOD_QUIZZES_SET_QUIZ_STATUS", index: location.state.index, status: data.status });
                navigate("/quiz/review");
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

    return (
        <Container className="content px-3" style={{ maxWidth: "1000px" }}>
            <Row style={{ marginBottom: "25px" }}>
                <Col xs={"auto"} className="d-flex align-items-center justify-content-center">
                    <Button as={Link} to={`/quiz/review`}>
                        Back
                    </Button>
                </Col>
                <Col className="d-flex align-items-center justify-content-center">
                    <h1>Quiz</h1>
                </Col>
            </Row>
            <h1>{location.state.quiz.name}</h1>
            <h4>{location.state.quiz.description}</h4>
            <h3 style={{ marginTop: "25px", marginBottom: "25px" }}>Questions</h3>
            {error && <div>{error}</div>}
            {loading && <div>Loading...</div>}
            {questions && (
                <Row xs={1} className="g-4">
                    {questions.map((question, i) => (
                        <Col key={question.id} className="d-flex justify-content-center">
                            <QuestionCard index={i} question={question} />
                        </Col>
                    ))}
                </Row>
            )}
            <Row className="justify-content-end" style={{ marginTop: "25px" }}>
                <Col xs={"auto"}>
                    <Button variant="primary" onClick={() => setStatus(0)}>
                        Reset
                    </Button>
                </Col>
                <Col xs={"auto"}>
                    <Button variant="primary" onClick={() => setStatus(1)}>
                        Verify
                    </Button>
                </Col>
                <Col xs={"auto"}>
                    <Button variant="danger" onClick={() => setStatus(-1)}>
                        Deny
                    </Button>
                </Col>
            </Row>
        </Container>
    );
};

export default ReviewQuiz;
