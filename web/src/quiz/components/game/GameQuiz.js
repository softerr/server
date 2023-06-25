import { Fragment, useEffect, useRef, useState } from "react";
import { Button, Card, Col, Container, Form, Modal, Row } from "react-bootstrap";
import { Plus, Trash } from "react-bootstrap-icons";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import myFetch from "../../../hooks/myFetch";

const GameQuiz = () => {
    const location = useLocation();
    const answerRefs = useRef([]);
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const { quizId, gameId } = useParams();
    const cachedUser = useSelector(state => state.user);
    const [gameQuiz, setGameQuiz] = useState();
    const [formErrors, setFormErrors] = useState({ answers: [], corrects: [] });
    const [value, setValue] = useState(null);

    useEffect(() => {
        if (location.state?.gameQuiz) {
            setGameQuiz(location.state.gameQuiz);
        }
    }, []);

    const handleNext = e => {
        e.preventDefault();

        const errors = { answers: [], corrects: [] };

        const answers = [];

        if (gameQuiz.question.type_id === 1 || gameQuiz.question.type_id === 2) {
            answerRefs.current.forEach(({ correctRef }, i) => {
                if (!correctRef) {
                    return;
                }

                const correct = correctRef.checked;
                answers.push({ id: gameQuiz.question.answers[i].id, user_correct: correct });
            });
        } else if (gameQuiz.question.type_id === 3 || gameQuiz.question.type_id === 4 || gameQuiz.question.type_id === 8) {
            answers.push({ id: gameQuiz.question.answers[0].id, user_correct: value });
        } else if (gameQuiz.question.type_id === 5 || gameQuiz.question.type_id === 6 || gameQuiz.question.type_id === 7) {
            if (gameQuiz.question.type_id === 5 && isNaN(answerRefs.current[0].answerRef.value)) {
                errors.answers[0] = "Answer must be number";
            }
            answers.push({ id: gameQuiz.question.answers[0].id, user_answer: answerRefs.current[0].answerRef.value });
        }

        setFormErrors(errors);
        if (Object.keys(errors).length === 2 && errors.answers.length === 0 && errors.corrects.length === 0) {
            myFetch(
                `/api/quiz/quizzes/${quizId}/games/${gameId}`,
                "PATCH",
                cachedUser.token,
                { current_question: gameQuiz.current_question + 1, answers, end: gameQuiz.current_question >= gameQuiz.question_count - 1 },
                data => {
                    if (gameQuiz.current_question < gameQuiz.question_count - 1) {
                        setGameQuiz(data);
                        setValue(null);
                        answerRefs.current.forEach(({ answerRef, correctRef }, i) => {
                            if (answerRef) {
                                answerRef.value = "";
                            }
                            if (correctRef) {
                                correctRef.checked = 0;
                            }
                        });
                    } else {
                        navigate(`/quiz/quizzes/${quizId}/games/${gameId}/results`, { state: { gameQuiz: data } });
                    }
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
        }
    };

    const addAnswerRef = (answerRef, i) => {
        if (!answerRefs.current[i]) {
            answerRefs.current[i] = {};
        }
        answerRefs.current[i].answerRef = answerRef;
    };

    const addCorrectRef = (correctRef, i) => {
        if (!answerRefs.current[i]) {
            answerRefs.current[i] = {};
        }
        answerRefs.current[i].correctRef = correctRef;
    };

    const showAnswer = () => {
        const newValue = 1 - value;

        const answers = [];
        answers.push({ id: gameQuiz.question.answers[0].id, user_correct: newValue });
        myFetch(
            `/api/quiz/quizzes/${quizId}/games/${gameId}`,
            "PATCH",
            cachedUser.token,
            { current_question: gameQuiz.current_question, answers },
            data => {
                setGameQuiz(data);
                setValue(newValue);
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
        <Container className="content px-3">
            {gameQuiz && (
                <Form noValidate>
                    <h2 style={{ marginBottom: "50px" }}>{gameQuiz.question.question}</h2>
                    {gameQuiz.question.type_id === 1 && gameQuiz.question.answers.map((answer, i) => <Form.Check type={"checkbox"} label={answer.answer} ref={ref => addCorrectRef(ref, i)} defaultChecked={false} />)}
                    {gameQuiz.question.type_id === 2 &&
                        gameQuiz.question.answers.map((answer, i) => (
                            <Form.Check key={answer.id}>
                                <Form.Check.Input name={"correct"} type={"radio"} ref={ref => addCorrectRef(ref, i)} defaultChecked={false} />
                                <Form.Check.Label>{answer.answer}</Form.Check.Label>
                            </Form.Check>
                        ))}
                    {(gameQuiz.question.type_id === 3 || gameQuiz.question.type_id === 4) && (
                        <Row>
                            <Col xs={"auto"}>
                                <Button variant="primary" onClick={() => setValue(1)} disabled={value === 1}>
                                    {gameQuiz.question.type_id === 3 ? "True" : "Yes"}
                                </Button>
                            </Col>
                            <Col xs={"auto"}>
                                <Button variant="primary" onClick={() => setValue(0)} disabled={value === 0}>
                                    {gameQuiz.question.type_id === 3 ? "False" : "No"}
                                </Button>
                            </Col>
                        </Row>
                    )}
                    {(gameQuiz.question.type_id === 5 || gameQuiz.question.type_id === 6 || gameQuiz.question.type_id === 7) && (
                        <Fragment>
                            {gameQuiz.question.type_id === 5 && "Enter number"}
                            {(gameQuiz.question.type_id === 6 || gameQuiz.question.type_id === 7) && "Enter answer"}
                            <Form.Group className="mt-3 mb-3">
                                {gameQuiz.question.type_id === 6 ? <Form.Control as="textarea" type="text" ref={ref => addAnswerRef(ref, 0)} isInvalid={!!formErrors.answers[0]}></Form.Control> : <Form.Control type="text" ref={ref => addAnswerRef(ref, 0)} isInvalid={!!formErrors.answers[0]}></Form.Control>}
                                <Form.Control.Feedback type="invalid">{formErrors.answers[0]}</Form.Control.Feedback>
                            </Form.Group>
                        </Fragment>
                    )}
                    {gameQuiz.question.type_id === 8 && (
                        <Fragment>
                            {value === 1 && <p>{gameQuiz.question.answers[0].answer}</p>}
                            <Button variant="primary" onClick={showAnswer}>
                                {!value || value === 0 ? "Show answer" : "Hide answer"}
                            </Button>
                        </Fragment>
                    )}
                    <Row className="justify-content-end" style={{ marginTop: "50px" }}>
                        <Col xs={"auto"}>
                            <Button variant="primary" onClick={handleNext}>
                                {gameQuiz.current_question < gameQuiz.question_count - 1 ? "Next" : "Finish"}
                            </Button>
                        </Col>
                    </Row>
                </Form>
            )}
        </Container>
    );
};

export default GameQuiz;
