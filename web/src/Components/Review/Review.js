import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import myFetch from "../../hooks/myFetch";
import { Button, Card, Col, Container, Row } from "react-bootstrap";
import { CheckCircle, Eye, XCircle } from "react-bootstrap-icons";
import { Link } from "react-router-dom";

const Review = () => {
    const cachedUser = useSelector(state => state.user);
    const cachedModQuizzes = useSelector(state => state.modQuizzes);
    const [{ quizzes, loading, error }, setState] = useState({});
    const dispatch = useDispatch();

    useEffect(() => {
        if (cachedModQuizzes.quizzes && cachedModQuizzes.quizzes.length > 0) {
            setState({ quizzes: cachedModQuizzes.quizzes, loading: false, error: null });
            return;
        }
        setState({ loading: true, error: null });
        return myFetch(
            `/api/quiz/modquizzes`,
            "GET",
            cachedUser.token,
            undefined,
            data => {
                dispatch({ type: "MOD_QUIZZES_SET", quizzes: data });
                setState({ quizzes: data, loading: false, error: null });
            },
            res => {
                setState({ loading: false, error: res });
            },
            msg => {
                setState({ loading: false, error: msg });
            }
        );
    }, []);

    return (
        <Container className="content px-3">
            <h1 style={{ marginBottom: "50px" }}>Review</h1>
            {error && <div>{error}</div>}
            {loading && <div>Loading...</div>}
            {quizzes && (
                <Row className="g-4">
                    {quizzes.map((quiz, i) => (
                        <Col xs={12} sm={6} lg={4} key={quiz.id} className="d-flex justify-content-center">
                            <Card style={{ width: "100%", minWidth: "235px", border: "1px solid #e8e8e8" }}>
                                <Card.Header style={{ borderBottom: "0px", backgroundColor: "#e8e8e8" }}>
                                    <Row className="g-3">
                                        <Col className="d-flex flex-grow-1 align-items-center">Quiz</Col>
                                        <Col xs={"auto"}>
                                            <Button variant="primary" className="p-1 icon-button d-flex align-items-center justify-content-center" as={Link} to={`/quiz/review/${quiz.id}`} state={{ quiz: quiz, index: i }}>
                                                <Eye size={16} />
                                            </Button>
                                        </Col>
                                    </Row>
                                </Card.Header>
                                <Card.Body className="d-flex flex-column">
                                    <Card.Title>
                                        <Row>
                                            <Col> {quiz.name}</Col>
                                            <Col xs={"auto"}>{quiz.status === 1 ? <CheckCircle color="green" /> : quiz.status === -1 && <XCircle color="red" />}</Col>
                                        </Row>
                                    </Card.Title>
                                    <Card.Text style={{ marginBottom: "auto" }}>{quiz.description ? quiz.description : ""}</Card.Text>
                                    <Card.Text className="text-secondary" style={{ marginBottom: "auto" }}>
                                        {quiz.question_count} {quiz.question_count === 1 ? "question" : "questions"}
                                    </Card.Text>
                                </Card.Body>
                            </Card>
                        </Col>
                    ))}
                </Row>
            )}
        </Container>
    );
};

export default Review;
