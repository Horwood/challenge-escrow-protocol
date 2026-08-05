// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice A deliberately small EVM shadow of the protocol state machine.
/// @dev Medusa fuzzes this harness independently from the Foundry handler and
///      the JavaScript model. It is not a replacement for testing production
///      bytecode; it checks that the state and accounting equations survive a
///      third execution engine's arbitrary call sequences.
contract MedusaChallengeHarness {
    enum State {
        NONE,
        OPEN,
        ACTIVE,
        PROPOSED,
        DISPUTED,
        CANCELLED,
        EXPIRED,
        RESOLVED_A,
        RESOLVED_B,
        VOID
    }

    State public state;
    bool public paused;
    bool public challengeExists;
    bool public challengerSideA;
    bool public finalWritten;
    bool public accepted;
    bool public challengerClaimable;
    bool public acceptorClaimable;
    bool public challengerPaid;
    bool public acceptorPaid;
    uint256 public stake;
    uint256 public deposited;
    uint256 public outstanding;
    uint256 public liability;
    uint256 public challengerEntitlement;
    uint256 public acceptorEntitlement;
    uint256 public challengerPaidAmount;
    uint256 public acceptorPaidAmount;
    uint256 public acceptanceNonce;
    uint256 public proposalDisputeDeadline;
    uint256 public arbitrationDeadline;
    uint256 public evidenceNonce;

    function actionCreate(uint256 rawStake, uint256 rawSide) external {
        if (challengeExists || paused) return;
        stake = 1 + (rawStake % 1_000_000_000_000_000_000);
        challengerSideA = rawSide % 2 == 0;
        deposited = stake;
        outstanding = stake;
        liability = stake;
        acceptanceNonce = 0;
        state = State.OPEN;
        challengeExists = true;
    }

    function actionPause(bool nextPaused) external {
        if (nextPaused == paused) return;
        paused = nextPaused;
    }

    function actionAdvanceNonce(uint256 rawTime) external {
        if (state != State.OPEN || _now(rawTime) >= 100) return;
        acceptanceNonce += 1;
    }

    function actionAccept(uint256 rawTime) external {
        if (paused || state != State.OPEN || _now(rawTime) >= 100) return;
        accepted = true;
        deposited += stake;
        outstanding += stake;
        liability += stake;
        state = State.ACTIVE;
    }

    function actionCancel(uint256 rawTime) external {
        if (state != State.OPEN || _now(rawTime) >= 100) return;
        state = State.CANCELLED;
        challengerClaimable = true;
        challengerEntitlement = stake;
    }

    function actionExpire(uint256 rawTime) external {
        if (state != State.OPEN || _now(rawTime) < 100) return;
        state = State.EXPIRED;
        challengerClaimable = true;
        challengerEntitlement = stake;
    }

    function actionPropose(uint8 rawOutcome, uint256 rawTime) external {
        uint256 currentTime = _now(rawTime);
        if (paused || state != State.ACTIVE || currentTime < 200 || currentTime >= 300) return;
        evidenceNonce += 1;
        proposalDisputeDeadline = currentTime + 20;
        state = State.PROPOSED;
        _proposalOutcome = rawOutcome % 3;
    }

    function actionDispute(uint8 rawOutcome, uint256 rawTime) external {
        uint256 currentTime = _now(rawTime);
        uint256 outcome = rawOutcome % 3;
        if (state != State.PROPOSED || currentTime >= proposalDisputeDeadline || outcome == _proposalOutcome) return;
        evidenceNonce += 1;
        uint256 arbitrationStart = currentTime < 250 ? 250 : currentTime;
        arbitrationDeadline = arbitrationStart + 30;
        state = State.DISPUTED;
        _disputeOutcome = outcome;
    }

    function actionFinalize(uint256 rawTime) external {
        if (state != State.PROPOSED || _now(rawTime) < proposalDisputeDeadline) return;
        _finalize(_proposalOutcome);
    }

    function actionArbitrate(uint8 rawOutcome, uint256 rawTime) external {
        uint256 currentTime = _now(rawTime);
        if (state != State.DISPUTED || currentTime < 250 || currentTime >= arbitrationDeadline) return;
        evidenceNonce += 1;
        _finalize(rawOutcome % 3);
    }

    function actionVoidUnproposed(uint256 rawTime) external {
        if (state != State.ACTIVE || _now(rawTime) < 300) return;
        _finalize(2);
    }

    function actionVoidUnarbitrated(uint256 rawTime) external {
        if (state != State.DISPUTED || _now(rawTime) < arbitrationDeadline) return;
        _finalize(2);
    }

    function actionClaim(uint256 rawCaller) external {
        bool challengerCaller = rawCaller % 2 == 0;
        if (state != State.RESOLVED_A && state != State.RESOLVED_B) return;
        bool challengerWins = (challengerSideA && state == State.RESOLVED_A)
            || (!challengerSideA && state == State.RESOLVED_B);
        if (challengerCaller != challengerWins) return;
        _pay(challengerCaller, stake * 2);
    }

    function actionRefund(uint256 rawCaller) external {
        bool challengerCaller = rawCaller % 2 == 0;
        if (state == State.CANCELLED || state == State.EXPIRED) {
            if (challengerCaller) _pay(true, stake);
            return;
        }
        if (state == State.VOID) _pay(challengerCaller, stake);
    }

    function property_accounting() external view returns (bool) {
        if (!challengeExists) return true;
        assert(deposited == outstanding + challengerPaidAmount + acceptorPaidAmount);
        assert(liability == outstanding);
        assert(outstanding <= deposited);
        return true;
    }

    function property_entitlements() external view returns (bool) {
        if (!challengeExists) return true;
        if (state == State.CANCELLED || state == State.EXPIRED) {
            assert(challengerEntitlement + challengerPaidAmount == stake);
            assert(acceptorEntitlement == 0 && acceptorPaidAmount == 0);
        }
        if (state == State.VOID) {
            assert(challengerEntitlement + challengerPaidAmount == stake);
            assert(acceptorEntitlement + acceptorPaidAmount == stake);
        }
        if (state == State.RESOLVED_A || state == State.RESOLVED_B) {
            bool challengerWins = (challengerSideA && state == State.RESOLVED_A)
                || (!challengerSideA && state == State.RESOLVED_B);
            if (challengerWins) {
                assert(challengerEntitlement + challengerPaidAmount == stake * 2);
                assert(acceptorEntitlement == 0 && acceptorPaidAmount == 0);
            } else {
                assert(acceptorEntitlement + acceptorPaidAmount == stake * 2);
                assert(challengerEntitlement == 0 && challengerPaidAmount == 0);
            }
        }
        return true;
    }

    function property_terminalFinality() external view returns (bool) {
        if (!challengeExists) return true;
        if (state == State.RESOLVED_A || state == State.RESOLVED_B || state == State.VOID) {
            assert(finalWritten);
        }
        if (state == State.CANCELLED || state == State.EXPIRED) {
            assert(!accepted && !finalWritten);
        }
        return true;
    }

    function property_deadlineOrdering() external view returns (bool) {
        if (!challengeExists) return true;
        assert(100 < 200);
        assert(200 < 250);
        assert(250 < 300);
        assert(300 + 20 + 30 <= 400);
        return true;
    }

    function _finalize(uint256 outcome) private {
        finalWritten = true;
        if (outcome == 2) {
            state = State.VOID;
            challengerEntitlement = stake;
            acceptorEntitlement = stake;
            challengerClaimable = true;
            acceptorClaimable = true;
            return;
        }
        state = outcome == 0 ? State.RESOLVED_A : State.RESOLVED_B;
        bool challengerWins = (challengerSideA && outcome == 0)
            || (!challengerSideA && outcome == 1);
        if (challengerWins) {
            challengerEntitlement = stake * 2;
            challengerClaimable = true;
        } else {
            acceptorEntitlement = stake * 2;
            acceptorClaimable = true;
        }
    }

    function _pay(bool challenger, uint256 amount) private {
        if (challenger) {
            if (!challengerClaimable || challengerPaid || challengerEntitlement != amount) return;
            if (outstanding < amount || liability < amount) return;
            challengerClaimable = false;
            challengerPaid = true;
            challengerEntitlement = 0;
            challengerPaidAmount = amount;
        } else {
            if (!acceptorClaimable || acceptorPaid || acceptorEntitlement != amount) return;
            if (outstanding < amount || liability < amount) return;
            acceptorClaimable = false;
            acceptorPaid = true;
            acceptorEntitlement = 0;
            acceptorPaidAmount = amount;
        }
        outstanding -= amount;
        liability -= amount;
    }

    function _now(uint256 rawTime) private pure returns (uint256) {
        return rawTime % 500;
    }

    uint256 private _proposalOutcome;
    uint256 private _disputeOutcome;
}
