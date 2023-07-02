import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { Button, Col, Container, Dropdown, DropdownButton, Form, Modal, Row, Table } from "react-bootstrap";
import { Trash } from "react-bootstrap-icons";
import { createOrUpdateUserRole, getRoles, getUserRoles, deleteUserRole } from "../../services";
import { updateUser } from "../../../users/services";

const DeleteModal = ({ show, onYes, onNo, role }) => {
    return (
        <Modal show={show} size="md" aria-labelledby="contained-modal-title-vcenter" centered>
            <Modal.Header closeButton>
                <Modal.Title id="contained-modal-title-vcenter">Remove {role} role</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p>Are you sure you want to remove {role} role?</p>
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
};

const UserEdit = () => {
    const cachedUser = useSelector(state => state.user);
    const cachedRoles = useSelector(state => state.roles);
    const [{ user, loading, error }, setState] = useState({});
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { userId } = useParams();
    const location = useLocation();
    const usernameRef = useRef(null);
    const emailRef = useRef(null);
    const roleRef = useRef(null);
    const [formErrors, setFormErrors] = useState({});
    const [modal, setModal] = useState({ show: false, role: "" });
    const [{ roles, rloading, rerror }, setRolesState] = useState({});
    const [{ uroles, urloading, urerror }, setUserRolesState] = useState({});

    useEffect(() => {
        if (location.state.user) {
            usernameRef.current.value = location.state.user.username;
            emailRef.current.value = location.state.user.email;
            setState({ user: location.state.user, loading: false, error: null });
        }
        if (cachedRoles.roles && cachedRoles.roles.length > 0) {
            setRolesState({ roles: cachedRoles.roles, rloading: false, rerror: null });
        } else {
            setRolesState({ rloading: true, rerror: null });
            getRoles(cachedUser.token,
                data => {
                    dispatch({ type: "ROLES_SET", roles: data });
                    setRolesState({ roles: data, rloading: false, rerror: null });
                },
                res => setRolesState({ rloading: false, rerror: res })
            );
        }

        if (!uroles || uroles.length === 0) {
            setUserRolesState({ urloading: true, urerror: null });
            getUserRoles(cachedUser.token, userId,
                data => setUserRolesState({ uroles: data, urloading: false, urerror: null }),
                res => setUserRolesState({ urloading: false, urerror: res })
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const handleSubmit = e => {
        console.log(roleRef.current);
        e.preventDefault();
        const username = usernameRef.current.value;
        const email = emailRef.current.value;

        const errors = {};

        if (!email) {
            errors.email = "Email ir required";
        } else if (email.trim().length !== email.length) {
            errors.email = "Email cannot start or end with a space";
        } else if (!email.match(/^\S+@\S+\.\S+$/)) {
            errors.email = "Email format is not valid";
        }

        if (!username) {
        } else if (username.trim().length !== username.length) {
            errors.username = "Username cannot start or end with a space";
        }

        setFormErrors(errors);
        if (Object.keys(errors).length === 0) {
            updateUser(cachedUser.token, userId, { email, username },
                () => { },
                res => {
                    console.log(res);
                }
            );
        }
    };

    const onRoleChange = (e, id) => {
        const role = Number(e.target.id);
        if (!Number.isInteger(role)) {
            return;
        }

        createOrUpdateUserRole(cachedUser.token, userId, id, { role_id: role },
            data => setUserRolesState({ uroles: uroles.map(urole => (urole.id === data.id || urole.id === 0 ? data : urole)), urloading: false, urerror: null }),
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

    const addRole = () => {
        uroles.push({ id: 0 });
        setUserRolesState({ uroles, urloading: false, urerror: null });
    };

    const onModalYes = () => {
        deleteUserRole(cachedUser.token, userId, modal.id,
            () => setUserRolesState({ uroles: uroles.filter(urole => urole.id !== modal.id), urloading: false, urerror: null }),
            res => console.log(res)
        );
        setModal({ show: false });
    };

    const onDelete = urole => {
        if (urole.id === 0) {
            setUserRolesState({ uroles: uroles.filter(urole => urole.id !== 0), urloading: false, urerror: null });
        } else {
            setModal({ show: true, id: urole.id, role: roles.find(role => role.id === urole.role_id).name });
        }
    };

    return (
        <Container className="content px-3" style={{ maxWidth: "1000px" }}>
            {error && <div>{error}</div>}
            {loading && <div>Loading...</div>}
            {rerror && <div>{rerror}</div>}
            {rloading && <div>Loading...</div>}
            {urerror && <div>{urerror}</div>}
            {urloading && <div>Loading...</div>}
            <Row style={{ marginBottom: "25px" }}>
                <Col xs={"auto"} className="d-flex align-items-center justify-content-center">
                    <Button as={Link} to={`/quiz/users`}>
                        Back
                    </Button>
                </Col>
                <Col className="d-flex align-items-center justify-content-center">
                    <h1>User</h1>
                </Col>
            </Row>
            <Form onSubmit={handleSubmit} noValidate>
                <Form.Group className="mb-3">
                    <Form.Label>Email address</Form.Label>
                    <Form.Control type="email" placeholder="Enter email" ref={emailRef} isInvalid={!!formErrors.email}></Form.Control>
                    <Form.Control.Feedback type="invalid">{formErrors.email}</Form.Control.Feedback>
                </Form.Group>
                <Form.Group className="mb-3">
                    <Form.Label>Username (optional)</Form.Label>
                    <Form.Control type="text" placeholder="Enter username" ref={usernameRef} isInvalid={!!formErrors.username}></Form.Control>
                    <Form.Control.Feedback type="invalid">{formErrors.username}</Form.Control.Feedback>
                </Form.Group>
                <Row className="justify-content-end">
                    <Col xs={"auto"}>
                        <Button variant="primary" type="submit">
                            Save
                        </Button>
                    </Col>
                </Row>
            </Form>
            <h3 style={{ marginTop: "25px", marginBottom: "25px" }}>Roles</h3>
            {user && roles && uroles && (
                <Fragment>
                    <Table striped bordered hover>
                        <thead>
                            <tr>
                                <th>Role</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {uroles.map((urole, i) => (
                                <tr key={urole.id}>
                                    <DropdownButton id="dropdown-basic-button" title={urole.role_id ? roles.find(role => role.id === urole.role_id).name : "Role"} onClick={e => onRoleChange(e, urole.id)}>
                                        {roles.map(role => (
                                            <Dropdown.Item key={role.id} id={role.id}>
                                                {role.name}
                                            </Dropdown.Item>
                                        ))}
                                    </DropdownButton>
                                    <td>
                                        <Row className="g-3">
                                            <Col xs={"auto"}>
                                                <Button variant="danger" className="p-1 icon-button d-flex align-items-center justify-content-center" onClick={() => onDelete(urole)}>
                                                    <Trash size={16} />
                                                </Button>
                                            </Col>
                                        </Row>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    <Button variant="primary" onClick={addRole} disabled={uroles.find(urole => urole.id === 0)}>
                        Add Role
                    </Button>
                    <DeleteModal role={modal.role} show={modal.show} onYes={onModalYes} onNo={() => setModal({ show: false })} />
                </Fragment>
            )}
        </Container>
    );
};

export default UserEdit;
