import { Fragment, useEffect, useRef, useState } from "react";
import { Button, Card, Col, Container, Dropdown, DropdownButton, Form, Modal, Row } from "react-bootstrap";
import { Plus, Trash } from "react-bootstrap-icons";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import myFetch from "../../../hooks/myFetch";

function DeleteModal({ show, onYes, onNo }) {
    return (
        <Modal show={show} size="md" aria-labelledby="contained-modal-title-vcenter" centered>
            <Modal.Header closeButton>
                <Modal.Title id="contained-modal-title-vcenter">Delete answer</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p>Are you sure you want to delete this answer?</p>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="primary" onClick={onNo}>
                    No
                </Button>
                <Button variant="danger" onClick={onYes}>
                    Yes
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

const LibraryQuestionEdit = () => {
    const location = useLocation();
    const cachedUser = useSelector(state => state.user);
    const cachedTypes = useSelector(state => state.types);
    const { quizId, questionId } = useParams();
    const questionRef = useRef(null);
    const answerRefs = useRef([]);
    const [formErrors, setFormErrors] = useState({ answers: [], corrects: [] });
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const [{ questionData, nextAnswerId }, setQuestionData] = useState({ questionData: { answers: [] }, nextAnswerId: 0 });
    const [modal, setModal] = useState({ show: false, id: 0 });
    const [scroll, setScroll] = useState(false);
    const [{ types, tloading, terror }, setTypesState] = useState({});

    const setType = type => {
        questionData.type_id = type;
        let answerId = 0;
        if (type === 1 || type === 2) {
            questionData.answers = [
                { id: 0, answer: "", correct: 0 },
                { id: 1, answer: "", correct: 0 },
            ];
            answerId = 2;
        } else if (type === 3 || type === 4) {
            questionData.answers = [{ id: 0, correct: 0 }];
        } else if (type === 5 || type === 7 || type === 8) {
            questionData.answers = [{ id: 0, answer: "" }];
        } else if (type === 6) {
            questionData.answers = [{ id: 0 }];
        } else if (type === 9) {
            questionData.answers = [];
        }

        return answerId;
    };

    useEffect(() => {
        if (location.state?.question) {
            questionData.type_id = location.state.question.type_id;
            questionData.question = location.state.question.question;
            questionData.answers = [];
            location.state.question.answers.forEach((answer, i) => {
                questionData.answers.push({ ...answer, id: i });
            });
            setQuestionData({ questionData, nextAnswerId: location.state.question.answers.length });
            questionRef.current.value = location.state.question.question;
        } else {
            const answerId = setType(location.state.type);
            setQuestionData({ questionData, answerId });
        }

        if (cachedTypes.types && cachedTypes.types.length > 0) {
            setTypesState({ types: cachedTypes.types, tloading: false, terror: null });
        } else {
            setTypesState({ tloading: true, terror: null });
            myFetch(
                `/api/quiz/types`,
                "GET",
                cachedUser.token,
                undefined,
                data => {
                    dispatch({ type: "TYPES_SET", types: data });
                    setTypesState({ types: data, tloading: false, terror: null });
                },
                res => {
                    setTypesState({ tloading: false, terror: res });
                },
                msg => {
                    setTypesState({ tloading: false, terror: msg });
                }
            );
        }
    }, []);

    const onModalYes = () => {
        questionData.answers.splice(modal.id, 1);
        setQuestionData({ questionData, nextAnswerId });
        setModal({ show: false });
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

    const handleSubmit = e => {
        e.preventDefault();
        const question = questionRef.current.value;

        const errors = { answers: [], corrects: [] };

        if (!question) {
            errors.question = "Question is required";
        } else if (question.trim().length !== question.length) {
            errors.question = "Question cannot start or end with a space";
        }

        const answers = [];

        if (questionData.type_id === 1 || questionData.type_id === 2 || questionData.type_id === 5 || questionData.type_id === 7 || questionData.type_id === 7) {
            let correctCount = 0;
            answerRefs.current.forEach(({ answerRef, correctRef }, i) => {
                if (!answerRef) {
                    return;
                }

                const answer = answerRef.value;
                const correct = questionData.type_id === 1 || questionData.type_id === 2 ? correctRef.checked : true;

                if (correct) {
                    correctCount++;
                }

                if (!answer) {
                    errors.answers[i] = "Answer is required";
                } else if (answer.trim().length !== answer.length) {
                    errors.answers[i] = "Answer cannot start or end with a space";
                } else if (questionData.type_id === 5 && isNaN(answer)) {
                    errors.answers[i] = "Answer must be number";
                }
                answers.push({ answer, correct });
            });

            if (correctCount !== 1) {
                answerRefs.current.forEach(({ answerRef, correctRef }, i) => {
                    errors.corrects[i] = "One must be correct";
                });
            }
        } else if (questionData.type_id === 3 || questionData.type_id === 4) {
            answers.push({ correct: answerRefs.current[0].correctRef.checked });
        } else if (questionData.type_id === 6) {
            answers.push({});
        }

        setFormErrors(errors);
        if (Object.keys(errors).length === 2 && errors.answers.length === 0 && errors.corrects.length === 0) {
            myFetch(
                questionId ? `/api/quiz/users/${cachedUser.id}/quizzes/${quizId}/questions/${questionId}` : `/api/quiz/users/${cachedUser.id}/quizzes/${quizId}/questions`,
                questionId ? "PATCH" : "POST",
                cachedUser.token,
                { question, answers, type_id: questionData.type_id },
                data => {
                    dispatch({ type: questionId ? "QUESTIONS_SET_QUESTION" : "QUESTIONS_ADD", question: data, userId: cachedUser.id, quizId: quizId });
                    navigate(-1);
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

    const addAnswer = () => {
        questionData.answers.push({ id: nextAnswerId, answer: "", correct: 0 });
        setQuestionData({ questionData, nextAnswerId: nextAnswerId + 1 });
        setScroll(true);
    };

    useEffect(() => {
        if (scroll) {
            setScroll(false);
            window.scrollTo({
                top: document.documentElement.scrollHeight,
                behavior: "auto",
            });
        }
    }, [scroll]);

    const onTypeChange = e => {
        const type = Number(e.target.id);
        if (!Number.isInteger(type)) {
            return;
        }

        const answerId = setType(type);
        setQuestionData({ questionData, nextAnswerId: answerId });
    };

    return (
        <Container className="content px-3" style={{ maxWidth: "1000px" }}>
            {terror && <div>{terror}</div>}
            {tloading && <div>Loading...</div>}
            <Row style={{ marginBottom: "25px" }}>
                <Col xs={"auto"} className="d-flex align-items-center justify-content-center">
                    <Button onClick={() => navigate(-1)}>Back</Button>
                </Col>
                <Col className="d-flex align-items-center justify-content-center">
                    <h1>Question</h1>
                </Col>
            </Row>

            <Form onSubmit={handleSubmit} noValidate>
                {types && (
                    <Row className="d-flex align-items-center justify-content-center" style={{ marginBottom: "10px" }}>
                        <Col xs={"auto"}>Type</Col>
                        <Col>
                            <DropdownButton id="dropdown-basic-button" title={types.find(type => type.id === questionData.type_id).label} onClick={onTypeChange}>
                                {types.map(type => (
                                    <Dropdown.Item key={type.id} id={type.id}>
                                        {type.label}
                                    </Dropdown.Item>
                                ))}
                            </DropdownButton>
                        </Col>
                    </Row>
                )}
                <Form.Group className="mb-3">
                    <Form.Label>Question</Form.Label>
                    <Form.Control as="textarea" type="text" placeholder="Enter question" ref={questionRef} isInvalid={!!formErrors.question}></Form.Control>
                    <Form.Control.Feedback type="invalid">{formErrors.question}</Form.Control.Feedback>
                </Form.Group>
                {questionData.type_id !== 6 && questionData.type_id !== 9 && (
                    <Fragment>
                        {(questionData.type_id === 3 || questionData.type_id === 4) && <Form.Check type={"checkbox"} label={`Correct`} ref={ref => addCorrectRef(ref, 0)} defaultChecked={questionData.answers[0].correct} />}
                        {(questionData.type_id === 1 || questionData.type_id === 2) && <Form.Label style={{ marginTop: "25px" }}>Answers</Form.Label>}
                        {questionData.type_id !== 3 &&
                            questionData.type_id !== 4 &&
                            questionData.answers.map((answer, i) => (
                                <Card id={answer.id} key={answer.id} className="w-100 mb-4" style={{ border: "1px solid #e8e8e8" }}>
                                    <Card.Header style={{ borderBottom: "0px", backgroundColor: "#e8e8e8" }}>
                                        <Row className="g-3">
                                            <Col xs={"auto"} className="d-flex flex-grow-1 align-items-center">
                                                Answer
                                            </Col>
                                            {(questionData.type_id === 1 || questionData.type_id === 2) && i > 1 && (
                                                <Col xs={"auto"}>
                                                    <Button variant="danger" className="p-1 icon-button d-flex align-items-center justify-content-center" onClick={() => setModal({ show: true, id: i })}>
                                                        <Trash size={16} />
                                                    </Button>
                                                </Col>
                                            )}
                                        </Row>
                                    </Card.Header>
                                    <Card.Body className="d-flex flex-column">
                                        <Form.Group className="mb-3">
                                            {questionData.type_id === 5 ? (
                                                <Form.Control type="text" placeholder="Enter answer" defaultValue={answer.answer} ref={ref => addAnswerRef(ref, i)} isInvalid={!!formErrors.answers[i]}></Form.Control>
                                            ) : (
                                                <Form.Control as="textarea" type="text" placeholder="Enter answer" defaultValue={answer.answer} ref={ref => addAnswerRef(ref, i)} isInvalid={!!formErrors.answers[i]}></Form.Control>
                                            )}
                                            <Form.Control.Feedback type="invalid">{formErrors.answers[i]}</Form.Control.Feedback>
                                        </Form.Group>
                                        {questionData.type_id === 1 && <Form.Check type={"checkbox"} label={`Correct`} ref={ref => addCorrectRef(ref, i)} defaultChecked={answer.correct} />}
                                        {questionData.type_id === 2 && (
                                            <Form.Check>
                                                <Form.Check.Input name={"correct"} type={"radio"} ref={ref => addCorrectRef(ref, i)} defaultChecked={answer.correct} isInvalid={!!formErrors.corrects[i]} />
                                                <Form.Check.Label>Correct</Form.Check.Label>
                                                <Form.Control.Feedback type="invalid">{formErrors.corrects[i]}</Form.Control.Feedback>
                                            </Form.Check>
                                        )}
                                    </Card.Body>
                                </Card>
                            ))}
                        {(questionData.type_id === 1 || questionData.type_id === 2) && (
                            <Card className="w-100 mb-4" onClick={addAnswer}>
                                <Card.Body className="d-flex align-items-center justify-content-center">
                                    <Plus size={64} color={"#979797"}></Plus>
                                </Card.Body>
                            </Card>
                        )}
                    </Fragment>
                )}
                <Row className="justify-content-end">
                    <Col xs={"auto"}>
                        <Button variant="primary" onClick={() => navigate(-1)}>
                            Cancel
                        </Button>
                    </Col>
                    <Col xs={"auto"}>
                        <Button className="w-100" variant="primary" type="submit">
                            {questionId ? "Save" : "Create"}
                        </Button>
                    </Col>
                </Row>
            </Form>
            <DeleteModal show={modal.show} onYes={onModalYes} onNo={() => setModal({ show: false })} />
        </Container>
    );
};

export default LibraryQuestionEdit;
