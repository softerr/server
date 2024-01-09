import { Fragment } from "react";
import { Button, Card, Col, Container, Form, Row } from "react-bootstrap";
import { Check, X } from "react-bootstrap-icons";
import { Link, useLocation, useParams } from "react-router-dom";

const Results = () => {
    const location = useLocation();
    const { quizId } = useParams();

    return (
        location.state?.gameQuiz && (
            <Container className="content px-3" style={{ maxWidth: "576px" }}>
                <Row style={{ marginBottom: "25px" }}>
                    <Col className="d-flex align-items-center justify-content-center">
                        <h1>Results</h1>
                    </Col>
                </Row>
                <Row xs={1} className="g-4">
                    {location.state.gameQuiz.questions.map(question => (
                        <Col key={question.id} className="d-flex justify-content-center">
                            <Card className="w-100">
                                <Card.Body>
                                    <Card.Title>{question.question}</Card.Title>
                                    {question.type_id !== 9 && <hr className="mb-0" />}
                                    {(question.type_id === 1 || question.type_id === 2) && (
                                        <Row xs={1} md={2} lg={3} className="g-4 mt-auto" style={{ marginLeft: "0.08rem", marginRight: "0.08rem" }}>
                                            {question.answers.map(answer => (
                                                <Col key={answer.id} className="w-100 d-flex align-items-center">
                                                    <Form.Check style={{ color: "black" }} type={question.type_id === 1 ? "checkbox" : "radio"} label={answer.answer} checked={answer.user_correct} disabled />
                                                    {answer.correct === answer.user_correct ? <Check color="green" size={24} /> : <X color="red" size={24} />}
                                                </Col>
                                            ))}
                                        </Row>
                                    )}
                                    {(question.type_id === 5 || question.type_id === 7) && (
                                        <Fragment>
                                            Your answer <br />
                                            {question.answers[0].user_answer} {question.answers[0].user_answer === question.answers[0].answer ? <Check color="green" size={24} /> : <X color="red" size={24} />}
                                            <br />
                                            Correct answer <br />
                                            {question.answers[0].answer}
                                            <br />
                                        </Fragment>
                                    )}
                                    {question.type_id === 6 && (
                                        <Fragment>
                                            Your answer <br />
                                            {question.answers[0].user_answer}
                                        </Fragment>
                                    )}
                                    {question.type_id === 3 && (
                                        <Fragment>
                                            Your answer <br />
                                            {question.answers[0].user_correct !== undefined && question.answers[0].user_correct !== null && (question.answers[0].user_correct === 1 ? "True" : "False")} {question.answers[0].correct === question.answers[0].user_correct ? <Check color="green" size={24} /> : <X color="red" size={24} />}
                                        </Fragment>
                                    )}
                                    {question.type_id === 4 && (
                                        <Fragment>
                                            Your answer <br />
                                            {question.answers[0].user_correct !== undefined && question.answers[0].user_correct !== null && (question.answers[0].user_correct === 1 ? "Yes" : "No")} {question.answers[0].correct === question.answers[0].user_correct ? <Check color="green" size={24} /> : <X color="red" size={24} />}
                                        </Fragment>
                                    )}
                                    {question.type_id === 8 && (
                                        <Fragment>
                                            Answer <br />
                                            {question.answers[0].answer}
                                        </Fragment>
                                    )}
                                </Card.Body>
                            </Card>
                        </Col>
                    ))}
                </Row>
                <Row className="justify-content-end" style={{ marginTop: "25px" }}>
                    <Col xs={"auto"}>
                        <Button variant="primary" as={Link} to={`/quiz/quizzes/${quizId}`}>
                            Play Again
                        </Button>
                    </Col>
                    <Col xs={"auto"}>
                        <Button variant="primary" as={Link} to={"/quiz"}>
                            Close
                        </Button>
                    </Col>
                </Row>
            </Container>
        )
    );
};

export default Results;
