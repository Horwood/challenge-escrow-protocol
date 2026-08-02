// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ChallengeEscrow } from "../../src/ChallengeEscrow.sol";
import { ChallengeTypes } from "../../src/ChallengeTypes.sol";
import { IncomingAdversarialToken } from "../mocks/IncomingAdversarialToken.sol";
import { AdversarialToken } from "../mocks/AdversarialToken.sol";

interface VmInvariantHandler {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
}

contract ChallengeEscrowInvariantHandler {
    struct Model {
        bool exists;
        ChallengeTypes.LifecycleState state;
        ChallengeTypes.Side challengerSide;
        ChallengeTypes.Outcome proposalOutcome;
        ChallengeTypes.Outcome disputeOutcome;
        ChallengeTypes.Outcome finalOutcome;
        address acceptor;
        uint256 stake;
        uint256 acceptanceNonce;
        uint256 deposited;
        uint256 outstanding;
        uint256 challengerClaimable;
        uint256 challengerPaid;
        uint256 acceptorClaimable;
        uint256 acceptorPaid;
        uint64 acceptanceDeadline;
        uint64 observationTime;
        uint64 sourceCorrectionCutoff;
        uint64 proposalDeadline;
        uint64 disputeDeadline;
        uint64 arbitrationDeadline;
        bytes32 proposalHash;
        bytes32 disputeHash;
        bytes32 finalHash;
        bool proposalExists;
        bool disputeExists;
        bool finalExists;
    }

    struct Snapshot {
        bytes32 challengeHash;
        bytes32 challengerEntitlementHash;
        bytes32 acceptorEntitlementHash;
        uint256 totalLiability;
        uint256 escrowBalance;
        bool paused;
    }

    VmInvariantHandler private constant vm =
        VmInvariantHandler(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant CHALLENGER_KEY = 0xA11CE;
    uint256 private constant ACCEPTOR_A_KEY = 0xB0B;
    uint64 private constant START = 1_900_000_000;
    uint256 private constant MAX_CHALLENGES = 8;
    bytes32 private constant TERMS_HASH = keccak256("stateful-invariant-terms");
    address private constant RESOLVER = address(0xBEEF);
    address private constant ARBITER = address(0xCA11);
    address private constant PAUSER = address(0xF00D);
    address private constant OTHER = address(0xDEAD);

    AdversarialToken private immutable token;
    ChallengeEscrow private immutable release;
    address private immutable challenger;
    address private immutable acceptorA;
    address private immutable acceptorB;

    bytes32[MAX_CHALLENGES] private challengeIds;
    Model[MAX_CHALLENGES] private models;
    uint256 private modelChallengeCount;
    uint256 private modelTotalLiability;
    uint256 private modelSurplus;
    bool private modelPaused;

    constructor() {
        vm.warp(START);
        challenger = vm.addr(CHALLENGER_KEY);
        acceptorA = vm.addr(ACCEPTOR_A_KEY);
        acceptorB = vm.addr(0xCAFE);
        token = new AdversarialToken();
        release = new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, PAUSER, false);
        token.mint(challenger, 1e30);
        token.mint(acceptorA, 1e30);
        token.mint(acceptorB, 1e30);
        _approve(challenger);
        _approve(acceptorA);
        _approve(acceptorB);
    }

    function actionCreate(uint256 rawStake, bool sideB) external {
        if (modelChallengeCount == MAX_CHALLENGES) return;
        uint256 index = modelChallengeCount;
        uint256 stake = _bound(rawStake, 1_000, 100_000_000);
        ChallengeTypes.ChallengeExecution memory execution = _execution(index, stake, sideB);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), TERMS_HASH);
        bytes32 challengeId = release.computeChallengeId(specHash);
        uint256 liabilityBefore = release.totalOutstandingLiability();
        uint256 balanceBefore = token.rawBalanceOf(address(release));

        bool ok = _invoke(
            challenger, abi.encodeCall(release.createAndFund, (execution, TERMS_HASH, specHash))
        );
        bool expected = !modelPaused;
        assert(ok == expected);
        if (!ok) {
            assert(!release.getChallenge(challengeId).exists);
            assert(release.totalOutstandingLiability() == liabilityBefore);
            assert(token.rawBalanceOf(address(release)) == balanceBefore);
            return;
        }

        challengeIds[index] = challengeId;
        Model storage model = models[index];
        model.exists = true;
        model.state = ChallengeTypes.LifecycleState.OPEN;
        model.challengerSide = execution.challengerSide;
        model.stake = stake;
        model.deposited = stake;
        model.outstanding = stake;
        model.acceptanceDeadline = execution.acceptanceDeadline;
        model.observationTime = execution.observationTime;
        model.sourceCorrectionCutoff = execution.sourceCorrectionCutoff;
        model.proposalDeadline = execution.proposalDeadline;
        modelChallengeCount += 1;
        modelTotalLiability += stake;
    }

    function actionWarp(uint256 rawDelta) external {
        vm.warp(block.timestamp + (rawDelta % 101));
    }

    function actionSetPause(bool newPaused, bool validCaller) external {
        bool expected = validCaller && newPaused != modelPaused;
        bool beforePaused = release.paused();
        uint256 liabilityBefore = release.totalOutstandingLiability();
        uint256 balanceBefore = token.rawBalanceOf(address(release));
        bool ok =
            _invoke(validCaller ? PAUSER : OTHER, abi.encodeCall(release.setPaused, (newPaused)));
        assert(ok == expected);
        if (ok) {
            modelPaused = newPaused;
        } else {
            assert(release.paused() == beforePaused);
            assert(release.totalOutstandingLiability() == liabilityBefore);
            assert(token.rawBalanceOf(address(release)) == balanceBefore);
        }
    }

    function actionAccept(uint256 rawIndex, bool validPermit, bool useSecondAcceptor) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        bytes32 challengeId = challengeIds[index];
        address acceptingWallet = useSecondAcceptor ? acceptorB : acceptorA;
        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: challengeId,
            specHash: release.getChallenge(challengeId).specHash,
            acceptingWallet: acceptingWallet,
            acceptanceNonce: validPermit ? model.acceptanceNonce : model.acceptanceNonce + 1,
            expiresAt: model.acceptanceDeadline
        });
        bytes memory signature = _sign(permit);
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.OPEN && !modelPaused
            && block.timestamp < model.acceptanceDeadline && validPermit;
        bool ok = _invoke(
            acceptingWallet, abi.encodeCall(release.accept, (challengeId, permit, signature))
        );
        assert(ok == expected);
        if (!ok) return _assertUnchanged(index, beforeState);

        model.state = ChallengeTypes.LifecycleState.ACTIVE;
        model.acceptor = acceptingWallet;
        model.deposited += model.stake;
        model.outstanding += model.stake;
        modelTotalLiability += model.stake;
    }

    function actionAdvanceNonce(uint256 rawIndex, bool validCaller) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.OPEN && validCaller
            && block.timestamp < model.acceptanceDeadline;
        bool ok = _invoke(
            validCaller ? challenger : OTHER,
            abi.encodeCall(release.advanceAcceptanceNonce, (challengeIds[index]))
        );
        assert(ok == expected);
        if (ok) model.acceptanceNonce += 1;
        else _assertUnchanged(index, beforeState);
    }

    function actionCancel(uint256 rawIndex, bool validCaller) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.OPEN && validCaller
            && block.timestamp < model.acceptanceDeadline;
        bool ok = _invoke(
            validCaller ? challenger : OTHER,
            abi.encodeCall(release.cancelOpen, (challengeIds[index]))
        );
        assert(ok == expected);
        if (ok) {
            model.state = ChallengeTypes.LifecycleState.CANCELLED;
            model.challengerClaimable = model.stake;
        } else {
            _assertUnchanged(index, beforeState);
        }
    }

    function actionExpire(uint256 rawIndex) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.OPEN
            && block.timestamp >= model.acceptanceDeadline;
        bool ok = _invoke(OTHER, abi.encodeCall(release.expireOpen, (challengeIds[index])));
        assert(ok == expected);
        if (ok) {
            model.state = ChallengeTypes.LifecycleState.EXPIRED;
            model.challengerClaimable = model.stake;
        } else {
            _assertUnchanged(index, beforeState);
        }
    }

    function actionPropose(uint256 rawIndex, uint8 rawOutcome, bool validCaller) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        ChallengeTypes.Outcome outcome = ChallengeTypes.Outcome(rawOutcome % 3);
        uint8 reason = outcome == ChallengeTypes.Outcome.VOID ? 5 : 0;
        bytes32 evidenceHash = keccak256(abi.encodePacked("proposal", index));
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.ACTIVE && !modelPaused
            && validCaller && block.timestamp >= model.observationTime
            && block.timestamp < model.proposalDeadline;
        bool ok = _invoke(
            validCaller ? RESOLVER : OTHER,
            abi.encodeCall(release.propose, (challengeIds[index], outcome, reason, evidenceHash))
        );
        assert(ok == expected);
        if (!ok) return _assertUnchanged(index, beforeState);
        model.state = ChallengeTypes.LifecycleState.PROPOSED;
        model.proposalExists = true;
        model.proposalOutcome = outcome;
        model.proposalHash = evidenceHash;
        model.disputeDeadline = uint64(block.timestamp) + 80;
    }

    function actionDispute(uint256 rawIndex, uint8 rawOffset, bool validCaller) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        ChallengeTypes.Outcome outcome = ChallengeTypes.Outcome(
            (uint8(model.proposalOutcome) + uint8((rawOffset % 2) + 1)) % 3
        );
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.PROPOSED && validCaller
            && block.timestamp < model.disputeDeadline;
        address caller = validCaller ? (rawOffset % 2 == 0 ? challenger : model.acceptor) : OTHER;
        bool ok = _invokeDispute(index, outcome, caller);
        assert(ok == expected);
        if (!ok) return _assertUnchanged(index, beforeState);
        model.state = ChallengeTypes.LifecycleState.DISPUTED;
        model.disputeExists = true;
        model.disputeOutcome = outcome;
        model.disputeHash = _disputeEvidence(index);
        uint64 arbitrationStart = uint64(block.timestamp) < model.sourceCorrectionCutoff
            ? model.sourceCorrectionCutoff
            : uint64(block.timestamp);
        model.arbitrationDeadline = arbitrationStart + 80;
    }

    function actionFinalize(uint256 rawIndex) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.PROPOSED
            && block.timestamp >= model.disputeDeadline;
        bool ok = _invoke(OTHER, abi.encodeCall(release.finalizeUncontested, (challengeIds[index])));
        assert(ok == expected);
        if (ok) _setTerminal(model, model.proposalOutcome, model.proposalHash);
        else _assertUnchanged(index, beforeState);
    }

    function actionArbitrate(uint256 rawIndex, uint8 rawOutcome, bool validCaller) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        ChallengeTypes.Outcome outcome = ChallengeTypes.Outcome(rawOutcome % 3);
        uint8 reason = outcome == ChallengeTypes.Outcome.VOID ? 4 : 0;
        bytes32 evidenceHash = keccak256(abi.encodePacked("arbiter", index));
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.DISPUTED && validCaller
            && block.timestamp >= model.sourceCorrectionCutoff
            && block.timestamp < model.arbitrationDeadline;
        bool ok = _invoke(
            validCaller ? ARBITER : OTHER,
            abi.encodeCall(
                release.arbitrate,
                (challengeIds[index], outcome, reason, evidenceHash, model.disputeHash)
            )
        );
        assert(ok == expected);
        if (ok) _setTerminal(model, outcome, evidenceHash);
        else _assertUnchanged(index, beforeState);
    }

    function actionVoidUnproposed(uint256 rawIndex) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.ACTIVE
            && block.timestamp >= model.proposalDeadline;
        bool ok = _invoke(OTHER, abi.encodeCall(release.voidUnproposed, (challengeIds[index])));
        assert(ok == expected);
        if (ok) _setTerminal(model, ChallengeTypes.Outcome.VOID, bytes32(0));
        else _assertUnchanged(index, beforeState);
    }

    function actionVoidUnarbitrated(uint256 rawIndex) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        Snapshot memory beforeState = _snapshot(index);
        bool expected = model.state == ChallengeTypes.LifecycleState.DISPUTED
            && block.timestamp >= model.arbitrationDeadline;
        bool ok = _invoke(OTHER, abi.encodeCall(release.voidUnarbitrated, (challengeIds[index])));
        assert(ok == expected);
        if (ok) _setTerminal(model, ChallengeTypes.Outcome.VOID, bytes32(0));
        else _assertUnchanged(index, beforeState);
    }

    function actionClaim(uint256 rawIndex, uint8 rawCaller, uint8 rawMode, bool blocked) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        address caller = _caller(rawCaller, model);
        AdversarialToken.OutgoingMode mode = _outgoingMode(rawMode);
        token.setOutgoingMode(mode);
        token.setBlockedRecipient(blocked ? caller : address(0));
        Snapshot memory beforeState = _snapshot(index);
        address winner = _winner(model, model.finalOutcome);
        bool expected = _isResolved(model.state) && caller == winner
            && _claimable(model, caller) == model.stake * 2 && _outgoingSucceeds(mode) && !blocked;
        bool ok = _invoke(caller, abi.encodeCall(release.claimWinnings, (challengeIds[index])));
        assert(ok == expected);
        if (ok) _consume(model, caller, model.stake * 2);
        else _assertUnchanged(index, beforeState);
        _resetOutgoing();
    }

    function actionRefund(uint256 rawIndex, uint8 rawCaller, uint8 rawMode, bool blocked) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Model storage model = models[index];
        address caller = _caller(rawCaller, model);
        AdversarialToken.OutgoingMode mode = _outgoingMode(rawMode);
        token.setOutgoingMode(mode);
        token.setBlockedRecipient(blocked ? caller : address(0));
        Snapshot memory beforeState = _snapshot(index);
        bool refundable = model.state == ChallengeTypes.LifecycleState.CANCELLED
            || model.state == ChallengeTypes.LifecycleState.EXPIRED
            || model.state == ChallengeTypes.LifecycleState.VOID;
        bool allowedWallet = caller == challenger
            || (model.state == ChallengeTypes.LifecycleState.VOID && caller == model.acceptor);
        bool expected = refundable && allowedWallet && _claimable(model, caller) == model.stake
            && _outgoingSucceeds(mode) && !blocked;
        bool ok = _invoke(caller, abi.encodeCall(release.refundPrincipal, (challengeIds[index])));
        assert(ok == expected);
        if (ok) _consume(model, caller, model.stake);
        else _assertUnchanged(index, beforeState);
        _resetOutgoing();
    }

    function actionDirectSurplus(uint256 rawAmount) external {
        uint256 amount = _bound(rawAmount, 1, 10_000);
        token.mint(address(release), amount);
        modelSurplus += amount;
    }

    function actionUnknownMutation(uint256 rawIndex, bytes4) external {
        if (modelChallengeCount == 0) return;
        uint256 index = rawIndex % modelChallengeCount;
        Snapshot memory beforeState = _snapshot(index);
        bool ok = _invoke(OTHER, abi.encodePacked(bytes4(0xdeadbeef), challengeIds[index]));
        assert(!ok);
        _assertUnchanged(index, beforeState);
    }

    function assertFinancialModel() external view {
        assert(release.totalOutstandingLiability() == modelTotalLiability);
        assert(token.rawBalanceOf(address(release)) == modelTotalLiability + modelSurplus);
        for (uint256 index = 0; index < modelChallengeCount; index++) {
            Model storage model = models[index];
            ChallengeTypes.Challenge memory actual = release.getChallenge(challengeIds[index]);
            assert(actual.depositedAmount == model.deposited);
            assert(actual.outstandingLiability == model.outstanding);
            assert(model.deposited == model.outstanding + model.challengerPaid + model.acceptorPaid);
            _assertEntitlement(
                challengeIds[index], challenger, model.challengerClaimable, model.challengerPaid
            );
            if (model.acceptor != address(0)) {
                _assertEntitlement(
                    challengeIds[index], model.acceptor, model.acceptorClaimable, model.acceptorPaid
                );
            }
        }
    }

    function assertLifecycleModel() external view {
        for (uint256 index = 0; index < modelChallengeCount; index++) {
            Model storage model = models[index];
            ChallengeTypes.Challenge memory actual = release.getChallenge(challengeIds[index]);
            assert(actual.exists && actual.state == model.state);
            assert(actual.challengerWallet == challenger);
            assert(actual.acceptingWallet == model.acceptor);
            assert(actual.challengerSide == model.challengerSide);
            assert(actual.stakeAmount == model.stake);
            assert(actual.acceptanceNonce == model.acceptanceNonce);
            assert(actual.acceptanceDeadline == model.acceptanceDeadline);
            assert(actual.observationTime == model.observationTime);
            assert(actual.sourceCorrectionCutoff == model.sourceCorrectionCutoff);
            assert(actual.proposalDeadline == model.proposalDeadline);
            assert(actual.proposal.exists == model.proposalExists);
            if (model.proposalExists) {
                assert(actual.proposal.outcome == model.proposalOutcome);
                assert(actual.proposal.evidenceHash == model.proposalHash);
                assert(actual.proposal.disputeDeadline == model.disputeDeadline);
            }
            assert(actual.dispute.exists == model.disputeExists);
            if (model.disputeExists) {
                assert(actual.dispute.outcome == model.disputeOutcome);
                assert(actual.dispute.evidenceHash == model.disputeHash);
                assert(actual.dispute.arbitrationDeadline == model.arbitrationDeadline);
            }
            assert(actual.finalResolution.exists == model.finalExists);
            if (model.finalExists) {
                assert(actual.finalResolution.outcome == model.finalOutcome);
                assert(actual.finalResolution.finalEvidenceHash == model.finalHash);
            }
        }
    }

    function assertAuthorityAndPauseModel() external view {
        assert(release.paused() == modelPaused);
        assert(release.resolver() == RESOLVER);
        assert(release.arbiter() == ARBITER);
        assert(release.pauser() == PAUSER);
        assert(release.canonicalToken() == address(token));
    }

    function releaseAddress() external view returns (address) {
        return address(release);
    }

    function tokenAddress() external view returns (address) {
        return address(token);
    }

    function _execution(uint256 index, uint256 stake, bool sideB)
        private
        view
        returns (ChallengeTypes.ChallengeExecution memory)
    {
        uint64 now64 = uint64(block.timestamp);
        return ChallengeTypes.ChallengeExecution({
            nonce: keccak256(abi.encodePacked("stateful-invariant", index)),
            createdAt: now64 - 1,
            chainId: block.chainid,
            escrowContract: address(release),
            challengerWallet: challenger,
            challengerSide: sideB ? ChallengeTypes.Side.B : ChallengeTypes.Side.A,
            token: address(token),
            tokenDecimals: 6,
            stakeAmount: stake,
            acceptanceDeadline: now64 + 50,
            observationTime: now64 + 100,
            sourceCorrectionCutoff: now64 + 150,
            proposalDeadline: now64 + 200,
            disputeWindowSeconds: 80,
            arbitrationWindowSeconds: 80,
            timeoutVoidAt: now64 + 500
        });
    }

    function _setTerminal(Model storage model, ChallengeTypes.Outcome outcome, bytes32 evidenceHash)
        private
    {
        model.finalExists = true;
        model.finalOutcome = outcome;
        model.finalHash = evidenceHash;
        if (outcome == ChallengeTypes.Outcome.VOID) {
            model.state = ChallengeTypes.LifecycleState.VOID;
            model.challengerClaimable = model.stake;
            model.acceptorClaimable = model.stake;
        } else {
            model.state = outcome == ChallengeTypes.Outcome.A
                ? ChallengeTypes.LifecycleState.RESOLVED_A
                : ChallengeTypes.LifecycleState.RESOLVED_B;
            address winner = _winner(model, outcome);
            if (winner == challenger) model.challengerClaimable = model.stake * 2;
            else model.acceptorClaimable = model.stake * 2;
        }
    }

    function _invokeDispute(uint256 index, ChallengeTypes.Outcome outcome, address caller)
        private
        returns (bool)
    {
        Model storage model = models[index];
        uint8 reason = outcome == ChallengeTypes.Outcome.VOID ? 5 : 0;
        return _invoke(
            caller,
            abi.encodeCall(
                release.dispute,
                (challengeIds[index], outcome, reason, _disputeEvidence(index), model.proposalHash)
            )
        );
    }

    function _disputeEvidence(uint256 index) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("dispute", index));
    }

    function _consume(Model storage model, address wallet, uint256 amount) private {
        if (wallet == challenger) {
            model.challengerClaimable = 0;
            model.challengerPaid = amount;
        } else {
            model.acceptorClaimable = 0;
            model.acceptorPaid = amount;
        }
        model.outstanding -= amount;
        modelTotalLiability -= amount;
    }

    function _snapshot(uint256 index) private view returns (Snapshot memory snapshot) {
        bytes32 challengeId = challengeIds[index];
        Model storage model = models[index];
        snapshot.challengeHash = keccak256(abi.encode(release.getChallenge(challengeId)));
        snapshot.challengerEntitlementHash =
            keccak256(abi.encode(release.getEntitlement(challengeId, challenger)));
        snapshot.acceptorEntitlementHash =
            keccak256(abi.encode(release.getEntitlement(challengeId, model.acceptor)));
        snapshot.totalLiability = release.totalOutstandingLiability();
        snapshot.escrowBalance = token.rawBalanceOf(address(release));
        snapshot.paused = release.paused();
    }

    function _assertUnchanged(uint256 index, Snapshot memory snapshot) private view {
        bytes32 challengeId = challengeIds[index];
        Model storage model = models[index];
        assert(keccak256(abi.encode(release.getChallenge(challengeId))) == snapshot.challengeHash);
        assert(
            keccak256(abi.encode(release.getEntitlement(challengeId, challenger)))
                == snapshot.challengerEntitlementHash
        );
        assert(
            keccak256(abi.encode(release.getEntitlement(challengeId, model.acceptor)))
                == snapshot.acceptorEntitlementHash
        );
        assert(release.totalOutstandingLiability() == snapshot.totalLiability);
        assert(token.rawBalanceOf(address(release)) == snapshot.escrowBalance);
        assert(release.paused() == snapshot.paused);
    }

    function _assertEntitlement(
        bytes32 challengeId,
        address wallet,
        uint256 claimable,
        uint256 paid
    ) private view {
        ChallengeTypes.Entitlement memory actual = release.getEntitlement(challengeId, wallet);
        assert(actual.exists == (claimable != 0 || paid != 0));
        assert(actual.claimableAmount == claimable);
        assert(actual.paidAmount == paid);
    }

    function _claimable(Model storage model, address wallet) private view returns (uint256) {
        if (wallet == challenger) return model.challengerClaimable;
        if (wallet == model.acceptor) return model.acceptorClaimable;
        return 0;
    }

    function _caller(uint8 rawCaller, Model storage model) private view returns (address) {
        uint8 choice = rawCaller % 3;
        if (choice == 0) return challenger;
        if (choice == 1) return model.acceptor == address(0) ? acceptorA : model.acceptor;
        return OTHER;
    }

    function _winner(Model storage model, ChallengeTypes.Outcome outcome)
        private
        view
        returns (address)
    {
        bool challengerWon =
            (model.challengerSide == ChallengeTypes.Side.A && outcome == ChallengeTypes.Outcome.A)
                || (model.challengerSide == ChallengeTypes.Side.B
                    && outcome == ChallengeTypes.Outcome.B);
        return challengerWon ? challenger : model.acceptor;
    }

    function _isResolved(ChallengeTypes.LifecycleState state) private pure returns (bool) {
        return state == ChallengeTypes.LifecycleState.RESOLVED_A
            || state == ChallengeTypes.LifecycleState.RESOLVED_B;
    }

    function _outgoingMode(uint8 rawMode)
        private
        pure
        returns (AdversarialToken.OutgoingMode mode)
    {
        uint8 value = rawMode % 12;
        if (value == uint8(AdversarialToken.OutgoingMode.REENTER)) {
            value = uint8(AdversarialToken.OutgoingMode.RETURN_FALSE);
        }
        return AdversarialToken.OutgoingMode(value);
    }

    function _outgoingSucceeds(AdversarialToken.OutgoingMode mode) private pure returns (bool) {
        return mode == AdversarialToken.OutgoingMode.NORMAL
            || mode == AdversarialToken.OutgoingMode.NO_RETURN;
    }

    function _resetOutgoing() private {
        token.setBlockedRecipient(address(0));
        token.setOutgoingMode(AdversarialToken.OutgoingMode.NORMAL);
        token.setBalanceMode(AdversarialToken.BalanceMode.NORMAL);
    }

    function _sign(ChallengeTypes.AcceptancePermit memory permit)
        private
        returns (bytes memory signature)
    {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(permit));
        return abi.encodePacked(r, s, v);
    }

    function _approve(address owner) private {
        vm.prank(owner);
        token.approve(address(release), type(uint256).max);
    }

    function _invoke(address caller, bytes memory data) private returns (bool ok) {
        vm.prank(caller);
        (ok,) = address(release).call(data);
    }

    function _bound(uint256 value, uint256 minimum, uint256 maximum)
        private
        pure
        returns (uint256)
    {
        return minimum + (value % (maximum - minimum + 1));
    }
}

contract IncomingInvariantHandler {
    struct IncomingModel {
        bytes32 challengeId;
        uint256 stake;
        uint64 acceptanceDeadline;
        bool accepted;
    }

    VmInvariantHandler private constant vm =
        VmInvariantHandler(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant CHALLENGER_KEY = 0xD00D;
    uint256 private constant ACCEPTOR_KEY = 0xABCD;
    uint256 private constant MAX_CHALLENGES = 6;
    bytes32 private constant TERMS_HASH = keccak256("incoming-invariant-terms");
    address private constant RESOLVER = address(0x101);
    address private constant ARBITER = address(0x202);
    address private constant PAUSER = address(0x303);

    IncomingAdversarialToken private immutable token;
    ChallengeEscrow private immutable release;
    address private immutable challenger;
    address private immutable acceptor;
    IncomingModel[MAX_CHALLENGES] private models;
    uint256 private count;
    uint256 private modelLiability;

    constructor() {
        vm.warp(2_000_000_000);
        challenger = vm.addr(CHALLENGER_KEY);
        acceptor = vm.addr(ACCEPTOR_KEY);
        token = new IncomingAdversarialToken();
        release = new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, PAUSER, false);
        token.mint(challenger, 1e30);
        token.mint(acceptor, 1e30);
        vm.prank(challenger);
        token.approve(address(release), type(uint256).max);
        vm.prank(acceptor);
        token.approve(address(release), type(uint256).max);
    }

    function actionCreate(uint256 rawStake, uint8 rawTransferMode, uint8 rawBalanceMode) external {
        if (count == MAX_CHALLENGES) return;
        uint256 stake = 1_000 + (rawStake % 100_000_000);
        IncomingAdversarialToken.TransferMode transferMode =
            IncomingAdversarialToken.TransferMode(rawTransferMode % 8);
        IncomingAdversarialToken.BalanceMode balanceMode =
            IncomingAdversarialToken.BalanceMode(rawBalanceMode % 3);
        ChallengeTypes.ChallengeExecution memory execution = _execution(count, stake);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), TERMS_HASH);
        bytes32 challengeId = release.computeChallengeId(specHash);
        bytes memory callData =
            abi.encodeCall(release.createAndFund, (execution, TERMS_HASH, specHash));
        token.setTransferMode(transferMode);
        token.setBalanceMode(balanceMode);
        if (transferMode == IncomingAdversarialToken.TransferMode.REENTER) {
            token.setReentry(address(release), callData);
        }
        uint256 liabilityBefore = release.totalOutstandingLiability();
        uint256 balanceBefore = token.rawBalanceOf(address(release));
        bool ok = _invoke(challenger, callData);
        bool expected = balanceMode == IncomingAdversarialToken.BalanceMode.NORMAL
            && _incomingSucceeds(transferMode);
        assert(ok == expected);
        if (ok) {
            if (transferMode == IncomingAdversarialToken.TransferMode.REENTER) {
                assert(!token.reentrySucceeded());
            }
            models[count] = IncomingModel(challengeId, stake, execution.acceptanceDeadline, false);
            count += 1;
            modelLiability += stake;
        } else {
            assert(!release.getChallenge(challengeId).exists);
            assert(release.totalOutstandingLiability() == liabilityBefore);
            assert(token.rawBalanceOf(address(release)) == balanceBefore);
        }
        _resetModes();
    }

    function actionAccept(uint256 rawIndex, uint8 rawTransferMode, uint8 rawBalanceMode) external {
        if (count == 0) return;
        uint256 index = rawIndex % count;
        IncomingModel storage model = models[index];
        IncomingAdversarialToken.TransferMode transferMode =
            IncomingAdversarialToken.TransferMode(rawTransferMode % 8);
        IncomingAdversarialToken.BalanceMode balanceMode =
            IncomingAdversarialToken.BalanceMode(rawBalanceMode % 3);
        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: model.challengeId,
            specHash: release.getChallenge(model.challengeId).specHash,
            acceptingWallet: acceptor,
            acceptanceNonce: 0,
            expiresAt: model.acceptanceDeadline
        });
        bytes memory signature = _sign(permit);
        bytes memory callData =
            abi.encodeCall(release.accept, (model.challengeId, permit, signature));
        token.setTransferMode(transferMode);
        token.setBalanceMode(balanceMode);
        if (transferMode == IncomingAdversarialToken.TransferMode.REENTER) {
            token.setReentry(address(release), callData);
        }
        bytes32 challengeBefore = keccak256(abi.encode(release.getChallenge(model.challengeId)));
        uint256 liabilityBefore = release.totalOutstandingLiability();
        uint256 balanceBefore = token.rawBalanceOf(address(release));
        bool ok = _invoke(acceptor, callData);
        bool expected = !model.accepted && block.timestamp < model.acceptanceDeadline
            && balanceMode == IncomingAdversarialToken.BalanceMode.NORMAL
            && _incomingSucceeds(transferMode);
        assert(ok == expected);
        if (ok) {
            if (transferMode == IncomingAdversarialToken.TransferMode.REENTER) {
                assert(!token.reentrySucceeded());
            }
            model.accepted = true;
            modelLiability += model.stake;
        } else {
            assert(
                keccak256(abi.encode(release.getChallenge(model.challengeId))) == challengeBefore
            );
            assert(release.totalOutstandingLiability() == liabilityBefore);
            assert(token.rawBalanceOf(address(release)) == balanceBefore);
        }
        _resetModes();
    }

    function actionWarp(uint256 rawDelta) external {
        vm.warp(block.timestamp + (rawDelta % 101));
    }

    function assertIncomingModel() external view {
        assert(release.totalOutstandingLiability() == modelLiability);
        assert(token.rawBalanceOf(address(release)) == modelLiability);
        for (uint256 index = 0; index < count; index++) {
            IncomingModel storage model = models[index];
            ChallengeTypes.Challenge memory actual = release.getChallenge(model.challengeId);
            assert(actual.exists);
            assert(actual.stakeAmount == model.stake);
            assert(actual.depositedAmount == (model.accepted ? model.stake * 2 : model.stake));
            assert(actual.outstandingLiability == actual.depositedAmount);
            assert(
                actual.state
                    == (model.accepted
                            ? ChallengeTypes.LifecycleState.ACTIVE
                            : ChallengeTypes.LifecycleState.OPEN)
            );
        }
    }

    function _execution(uint256 index, uint256 stake)
        private
        view
        returns (ChallengeTypes.ChallengeExecution memory)
    {
        uint64 now64 = uint64(block.timestamp);
        return ChallengeTypes.ChallengeExecution({
            nonce: keccak256(abi.encodePacked("incoming-invariant", index)),
            createdAt: now64 - 1,
            chainId: block.chainid,
            escrowContract: address(release),
            challengerWallet: challenger,
            challengerSide: ChallengeTypes.Side.A,
            token: address(token),
            tokenDecimals: 6,
            stakeAmount: stake,
            acceptanceDeadline: now64 + 50,
            observationTime: now64 + 100,
            sourceCorrectionCutoff: now64 + 150,
            proposalDeadline: now64 + 200,
            disputeWindowSeconds: 80,
            arbitrationWindowSeconds: 80,
            timeoutVoidAt: now64 + 500
        });
    }

    function _incomingSucceeds(IncomingAdversarialToken.TransferMode mode)
        private
        pure
        returns (bool)
    {
        return mode == IncomingAdversarialToken.TransferMode.NORMAL
            || mode == IncomingAdversarialToken.TransferMode.NO_RETURN
            || mode == IncomingAdversarialToken.TransferMode.REENTER;
    }

    function _sign(ChallengeTypes.AcceptancePermit memory permit)
        private
        returns (bytes memory signature)
    {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(permit));
        return abi.encodePacked(r, s, v);
    }

    function _invoke(address caller, bytes memory data) private returns (bool ok) {
        vm.prank(caller);
        (ok,) = address(release).call(data);
    }

    function _resetModes() private {
        token.setTransferMode(IncomingAdversarialToken.TransferMode.NORMAL);
        token.setBalanceMode(IncomingAdversarialToken.BalanceMode.NORMAL);
    }
}
