import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import myFetch from "../../../hooks/myFetch";
import { Card, Col, Container, Row } from "react-bootstrap";
import { CheckCircle } from "react-bootstrap-icons";

const Explore = () => {
    const cachedUser = useSelector(state => state.user);
    const cachedPublicQuizzes = useSelector(state => state.publicQuizzes);
    const [{ quizzes, loading, error }, setState] = useState({});
    const dispatch = useDispatch();

    useEffect(() => {
        if (cachedPublicQuizzes.quizzes && cachedPublicQuizzes.quizzes.length > 0) {
            setState({ quizzes: cachedPublicQuizzes.quizzes, loading: false, error: null });
        }
        setState({ loading: true, error: null });
        return myFetch(
            `/api/quiz/quizzes`,
            "GET",
            cachedUser.token,
            undefined,
            data => {
                dispatch({ type: "PUBLIC_QUIZZES_SET", quizzes: data });
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
            <h1 style={{ marginBottom: "50px" }}>Explore</h1>
            {error && <div>{error}</div>}
            {loading && <div>Loading...</div>}
            {quizzes && (
                <Row className="g-4">
                    {quizzes.map(quiz => (
                        <Col xs={12} sm={6} lg={4} key={quiz.id} className="d-flex justify-content-center">
                            <Card style={{ width: "100%", minWidth: "235px" }}>
                                <Card.Body style={{ textDecoration: "none", color: "black" }} className="d-flex flex-column" as={Link} to={`/quiz/quizzes/${quiz.id}`}>
                                    <Card.Title style={{ color: "#0d6efd" }}>
                                        <Row>
                                            <Col> {quiz.name}</Col>
                                            <Col xs={"auto"}>{quiz.status === 1 && <CheckCircle color="green" />}</Col>
                                        </Row>
                                    </Card.Title>
                                    <Card.Text style={{ marginBottom: "auto" }}>{quiz.description ? quiz.description : ""}</Card.Text>
                                    <Card.Text className="text-secondary" style={{ marginBottom: "auto" }}>
                                        {quiz.question_count} {quiz.question_count === 1 ? "question" : "questions"} &nbsp; • &nbsp; {quiz.games} {quiz.games === 1 ? "play" : "plays"}
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

export default Explore;
