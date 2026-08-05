// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ChallengeEscrow } from "../src/ChallengeEscrow.sol";
import { ChallengeEscrowKernel } from "../src/ChallengeEscrowKernel.sol";
import { ChallengeTypes } from "../src/ChallengeTypes.sol";
import { ExactTokenDelta } from "../src/libraries/ExactTokenDelta.sol";
import { AdversarialToken } from "./mocks/AdversarialToken.sol";

interface VmSecurity {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
    function expectPartialRevert(bytes4 selector) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function store(address target, bytes32 slot, bytes32 value) external;
}

contract ChallengeEscrowSecurityTest {
    VmSecurity private constant vm =
        VmSecurity(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant CHALLENGER_KEY = 0xA11CE;
    uint256 private constant ACCEPTOR_KEY = 0xB0B;
    uint64 private constant NOW = 1_800_000_000;
    uint256 private constant STAKE = 10_000_000;
    bytes32 private constant TERMS_HASH =
        0x6ade1e23704b07995277edf96ccf2285990aaee78d20a0f77219965ef9dd7665;
    bytes32 private constant EVIDENCE_HASH = keccak256("security-resolution-evidence");
    bytes32 private constant WINNINGS_SIGNATURE =
        keccak256("WinningsClaimed(bytes32,bytes32,address,uint256)");
    bytes32 private constant REFUND_SIGNATURE =
        keccak256("PrincipalRefunded(bytes32,bytes32,address,uint8,uint256)");
    address private constant RESOLVER = address(0xBEEF);
    address private constant ARBITER = address(0xCA11);
    address private constant PAUSER = address(0xF00D);

    AdversarialToken private token;
    ChallengeEscrow private release;
    address private challenger;
    address private acceptor;
    address private other;

    function setUp() public {
        vm.warp(NOW);
        challenger = vm.addr(CHALLENGER_KEY);
        acceptor = vm.addr(ACCEPTOR_KEY);
        other = vm.addr(0xCAFE);
        token = new AdversarialToken();
        release = new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, PAUSER, false);
        token.mint(challenger, STAKE * 20);
        token.mint(acceptor, STAKE * 20);
        vm.prank(challenger);
        token.approve(address(release), type(uint256).max);
        vm.prank(acceptor);
        token.approve(address(release), type(uint256).max);
    }

    function testWinnerClaimPaysExactTwoStakesAndExactEvent() public {
        bytes32 challengeId =
            _resolved(bytes32(uint256(501)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        bytes32 entitlementId = release.computeEntitlementId(challengeId, challenger);
        vm.recordLogs();
        vm.prank(challenger);
        release.claimWinnings(challengeId);

        VmSecurity.Log[] memory logs = vm.getRecordedLogs();
        VmSecurity.Log memory payment = _findLog(logs, WINNINGS_SIGNATURE);
        require(payment.topics.length == 4 && payment.topics[1] == challengeId);
        require(payment.topics[2] == entitlementId);
        require(address(uint160(uint256(payment.topics[3]))) == challenger);
        require(abi.decode(payment.data, (uint256)) == STAKE * 2);
        _assertPaid(challengeId, challenger, STAKE * 2, 0);
        require(token.rawBalanceOf(challenger) == STAKE * 21);
        require(token.rawBalanceOf(address(release)) == 0);
    }

    function testSideAndOutcomeMappingsPayOnlyTheActualWinner() public {
        bytes32 first =
            _resolved(bytes32(uint256(502)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.B);
        vm.prank(acceptor);
        release.claimWinnings(first);
        _assertPaid(first, acceptor, STAKE * 2, 0);

        bytes32 second =
            _resolved(bytes32(uint256(503)), ChallengeTypes.Side.B, ChallengeTypes.Outcome.B);
        vm.prank(challenger);
        release.claimWinnings(second);
        _assertPaid(second, challenger, STAKE * 2, 0);
        require(release.totalOutstandingLiability() == 0);
    }

    function testClaimRejectsMissingWrongStateLosingAndRandomWallets() public {
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotFound.selector);
        vm.prank(challenger);
        release.claimWinnings(bytes32(uint256(999)));

        bytes32 openId = _open(bytes32(uint256(504)), ChallengeTypes.Side.A);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotResolved.selector);
        vm.prank(challenger);
        release.claimWinnings(openId);

        bytes32 resolvedId =
            _resolved(bytes32(uint256(505)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        vm.expectPartialRevert(ChallengeEscrowKernel.CallerNotWinningWallet.selector);
        vm.prank(acceptor);
        release.claimWinnings(resolvedId);
        vm.expectPartialRevert(ChallengeEscrowKernel.CallerNotWinningWallet.selector);
        vm.prank(other);
        release.claimWinnings(resolvedId);
        _assertClaimable(resolvedId, challenger, STAKE * 2);
    }

    function testSuccessfulClaimCannotRepeatAndFinalityDoesNotChange() public {
        bytes32 challengeId =
            _resolved(bytes32(uint256(506)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        ChallengeTypes.FinalResolution memory beforeResolution =
        release.getChallenge(challengeId).finalResolution;
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidEntitlement.selector);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        ChallengeTypes.Challenge memory afterChallenge = release.getChallenge(challengeId);
        require(afterChallenge.state == ChallengeTypes.LifecycleState.RESOLVED_A);
        require(
            afterChallenge.finalResolution.finalEvidenceHash == beforeResolution.finalEvidenceHash
        );
    }

    function testCancelledRefundPaysExactPrincipalAndEvent() public {
        bytes32 challengeId = _cancelled(bytes32(uint256(507)));
        bytes32 entitlementId = release.computeEntitlementId(challengeId, challenger);
        vm.recordLogs();
        vm.prank(challenger);
        release.refundPrincipal(challengeId);
        VmSecurity.Log memory payment = _findLog(vm.getRecordedLogs(), REFUND_SIGNATURE);
        require(payment.topics.length == 4 && payment.topics[1] == challengeId);
        require(payment.topics[2] == entitlementId);
        require(address(uint160(uint256(payment.topics[3]))) == challenger);
        (ChallengeTypes.LifecycleState originState, uint256 amount) =
            abi.decode(payment.data, (ChallengeTypes.LifecycleState, uint256));
        require(originState == ChallengeTypes.LifecycleState.CANCELLED && amount == STAKE);
        _assertPaid(challengeId, challenger, STAKE, 0);
    }

    function testExpiredRefundPaysExactPrincipal() public {
        bytes32 challengeId = _expired(bytes32(uint256(508)));
        vm.prank(challenger);
        release.refundPrincipal(challengeId);
        _assertPaid(challengeId, challenger, STAKE, 0);
        require(release.getChallenge(challengeId).state == ChallengeTypes.LifecycleState.EXPIRED);
    }

    function testVoidRefundsAreIndependentAndEachPayOnce() public {
        bytes32 challengeId = _void(bytes32(uint256(509)));
        vm.prank(challenger);
        release.refundPrincipal(challengeId);
        _assertPaid(challengeId, challenger, STAKE, STAKE);
        _assertClaimable(challengeId, acceptor, STAKE);
        vm.prank(acceptor);
        release.refundPrincipal(challengeId);
        _assertPaid(challengeId, acceptor, STAKE, 0);
        require(release.getChallenge(challengeId).state == ChallengeTypes.LifecycleState.VOID);
    }

    function testRefundRejectsWrongStateAndUnauthorizedWallet() public {
        bytes32 activeId = _active(bytes32(uint256(510)), ChallengeTypes.Side.A);
        vm.expectPartialRevert(ChallengeEscrowKernel.ChallengeNotRefundable.selector);
        vm.prank(challenger);
        release.refundPrincipal(activeId);

        bytes32 cancelledId = _cancelled(bytes32(uint256(511)));
        vm.expectPartialRevert(ChallengeEscrowKernel.CallerNotRefundRecipient.selector);
        vm.prank(acceptor);
        release.refundPrincipal(cancelledId);
        bytes32 voidId = _void(bytes32(uint256(512)));
        vm.expectPartialRevert(ChallengeEscrowKernel.CallerNotRefundRecipient.selector);
        vm.prank(other);
        release.refundPrincipal(voidId);
    }

    function testClaimsAndRefundsRemainAvailableWhilePaused() public {
        bytes32 resolvedId =
            _resolved(bytes32(uint256(513)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        bytes32 voidId = _void(bytes32(uint256(514)));
        _setPaused(true);
        vm.prank(challenger);
        release.claimWinnings(resolvedId);
        vm.prank(challenger);
        release.refundPrincipal(voidId);
        _assertPaid(resolvedId, challenger, STAKE * 2, 0);
        _assertPaid(voidId, challenger, STAKE, STAKE);
    }

    function testFalseRevertAndMalformedReturnsPreserveRetryableClaim() public {
        bytes32 challengeId =
            _resolved(bytes32(uint256(515)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        _expectOutgoingFailure(
            challengeId,
            AdversarialToken.OutgoingMode.RETURN_FALSE,
            ExactTokenDelta.TokenTransferReturnedFalse.selector
        );
        _expectOutgoingFailure(
            challengeId,
            AdversarialToken.OutgoingMode.REVERT_CALL,
            ExactTokenDelta.TokenTransferReverted.selector
        );
        _expectOutgoingFailure(
            challengeId,
            AdversarialToken.OutgoingMode.MALFORMED_RETURN,
            ExactTokenDelta.TokenTransferMalformedReturn.selector
        );
        token.setOutgoingMode(AdversarialToken.OutgoingMode.NO_RETURN);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        _assertPaid(challengeId, challenger, STAKE * 2, 0);
    }

    function testNonOneTokenReturnsFailClosedForPullAndPush() public {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(bytes32(uint256(524)), ChallengeTypes.Side.A);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), TERMS_HASH);
        token.setOutgoingMode(AdversarialToken.OutgoingMode.RETURN_NON_ONE);
        vm.expectPartialRevert(ExactTokenDelta.TokenTransferFromMalformedReturn.selector);
        vm.prank(challenger);
        release.createAndFund(execution, TERMS_HASH, specHash);

        token.setOutgoingMode(AdversarialToken.OutgoingMode.NORMAL);
        bytes32 challengeId =
            _resolved(bytes32(uint256(525)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        token.setOutgoingMode(AdversarialToken.OutgoingMode.RETURN_NON_ONE);
        vm.expectPartialRevert(ExactTokenDelta.TokenTransferMalformedReturn.selector);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        _assertClaimable(challengeId, challenger, STAKE * 2);
    }

    function testEveryEscrowAndRecipientDeltaMismatchRevertsAtomically() public {
        bytes32 challengeId =
            _resolved(bytes32(uint256(516)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        _expectOutgoingFailure(
            challengeId,
            AdversarialToken.OutgoingMode.UNDERCREDIT_RECIPIENT,
            ExactTokenDelta.TokenRecipientBalanceDeltaMismatch.selector
        );
        _expectOutgoingFailure(
            challengeId,
            AdversarialToken.OutgoingMode.OVERCREDIT_RECIPIENT,
            ExactTokenDelta.TokenRecipientBalanceDeltaMismatch.selector
        );
        _expectOutgoingFailure(
            challengeId,
            AdversarialToken.OutgoingMode.UNDERDEBIT_ESCROW,
            ExactTokenDelta.TokenSenderBalanceDeltaMismatch.selector
        );
        token.mint(address(release), 1);
        _expectOutgoingFailure(
            challengeId,
            AdversarialToken.OutgoingMode.OVERDEBIT_ESCROW,
            ExactTokenDelta.TokenSenderBalanceDeltaMismatch.selector
        );
    }

    function testPreAndPostBalanceQueryFailuresPreserveEntitlement() public {
        bytes32 challengeId =
            _resolved(bytes32(uint256(517)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        token.setBalanceMode(AdversarialToken.BalanceMode.REVERT_CALL);
        vm.expectPartialRevert(ExactTokenDelta.TokenBalanceQueryFailed.selector);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        token.setBalanceMode(AdversarialToken.BalanceMode.MALFORMED_RETURN);
        vm.expectPartialRevert(ExactTokenDelta.TokenBalanceQueryFailed.selector);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        token.setBalanceMode(AdversarialToken.BalanceMode.NORMAL);
        _expectOutgoingFailure(
            challengeId,
            AdversarialToken.OutgoingMode.POST_BALANCE_REVERT,
            ExactTokenDelta.TokenBalanceQueryFailed.selector
        );
        _expectOutgoingFailure(
            challengeId,
            AdversarialToken.OutgoingMode.POST_BALANCE_MALFORMED,
            ExactTokenDelta.TokenBalanceQueryFailed.selector
        );
    }

    function testOutgoingTokenReentryCannotConsumeEntitlementTwice() public {
        bytes32 challengeId =
            _resolved(bytes32(uint256(518)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        token.setReentry(address(release), abi.encodeCall(release.claimWinnings, (challengeId)));
        token.setOutgoingMode(AdversarialToken.OutgoingMode.REENTER);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        require(!token.reentrySucceeded());
        require(
            token.reentryResultSelector() == ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        _assertPaid(challengeId, challenger, STAKE * 2, 0);
    }

    function testBlockedVoidRecipientCannotBlockOtherWallet() public {
        bytes32 challengeId = _void(bytes32(uint256(519)));
        token.setBlockedRecipient(challenger);
        vm.expectPartialRevert(ExactTokenDelta.TokenTransferReverted.selector);
        vm.prank(challenger);
        release.refundPrincipal(challengeId);
        _assertClaimable(challengeId, challenger, STAKE);
        vm.prank(acceptor);
        release.refundPrincipal(challengeId);
        _assertPaid(challengeId, acceptor, STAKE, STAKE);
    }

    function testPreExistingDeficitFailsClosedUntilBalanceRestored() public {
        bytes32 challengeId =
            _resolved(bytes32(uint256(520)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        token.burn(address(release), 1);
        vm.expectPartialRevert(ChallengeEscrowKernel.EscrowInsolvent.selector);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        _assertClaimable(challengeId, challenger, STAKE * 2);
        token.mint(address(release), 1);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        _assertPaid(challengeId, challenger, STAKE * 2, 0);
    }

    function testUnsolicitedSurplusIsNeitherLiabilityNorWithdrawn() public {
        bytes32 challengeId =
            _resolved(bytes32(uint256(521)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        token.mint(address(release), STAKE * 3);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        require(token.rawBalanceOf(address(release)) == STAKE * 3);
        require(release.totalOutstandingLiability() == 0);
    }

    function testCorruptEntitlementAndLiabilityAccountingFailBeforeTransfer() public {
        bytes32 first =
            _resolved(bytes32(uint256(522)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        vm.store(address(release), _entitlementSlot(first, challenger, 1), bytes32(STAKE));
        vm.expectPartialRevert(ChallengeEscrowKernel.InvalidEntitlement.selector);
        vm.prank(challenger);
        release.claimWinnings(first);

        bytes32 second =
            _resolved(bytes32(uint256(523)), ChallengeTypes.Side.A, ChallengeTypes.Outcome.A);
        vm.store(address(release), bytes32(uint256(_challengeSlot(second)) + 10), bytes32(STAKE));
        vm.expectPartialRevert(ChallengeEscrowKernel.LiabilityAccountingMismatch.selector);
        vm.prank(challenger);
        release.claimWinnings(second);
    }

    function _expectOutgoingFailure(
        bytes32 challengeId,
        AdversarialToken.OutgoingMode mode,
        bytes4 selector
    ) private {
        uint256 balanceBefore = token.rawBalanceOf(address(release));
        token.setOutgoingMode(mode);
        vm.expectPartialRevert(selector);
        vm.prank(challenger);
        release.claimWinnings(challengeId);
        _assertClaimable(challengeId, challenger, STAKE * 2);
        require(token.rawBalanceOf(address(release)) == balanceBefore);
        require(release.totalOutstandingLiability() == STAKE * 2);
    }

    function _open(bytes32 nonce, ChallengeTypes.Side side) private returns (bytes32 challengeId) {
        ChallengeTypes.ChallengeExecution memory execution = _execution(nonce, side);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), TERMS_HASH);
        vm.prank(challenger);
        challengeId = release.createAndFund(execution, TERMS_HASH, specHash);
    }

    function _active(bytes32 nonce, ChallengeTypes.Side side)
        private
        returns (bytes32 challengeId)
    {
        ChallengeTypes.ChallengeExecution memory execution = _execution(nonce, side);
        bytes32 specHash =
            release.computeSpecHash(release.computeExecutionHash(execution), TERMS_HASH);
        vm.prank(challenger);
        challengeId = release.createAndFund(execution, TERMS_HASH, specHash);
        ChallengeTypes.AcceptancePermit memory permit = ChallengeTypes.AcceptancePermit({
            challengeId: challengeId,
            specHash: specHash,
            acceptingWallet: acceptor,
            acceptanceNonce: 0,
            expiresAt: execution.acceptanceDeadline
        });
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(CHALLENGER_KEY, release.hashAcceptancePermit(permit));
        vm.prank(acceptor);
        release.accept(challengeId, permit, abi.encodePacked(r, s, v));
    }

    function _cancelled(bytes32 nonce) private returns (bytes32 challengeId) {
        challengeId = _open(nonce, ChallengeTypes.Side.A);
        vm.prank(challenger);
        release.cancelOpen(challengeId);
    }

    function _expired(bytes32 nonce) private returns (bytes32 challengeId) {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(nonce, ChallengeTypes.Side.A);
        challengeId = _open(nonce, ChallengeTypes.Side.A);
        vm.warp(execution.acceptanceDeadline);
        release.expireOpen(challengeId);
    }

    function _resolved(bytes32 nonce, ChallengeTypes.Side side, ChallengeTypes.Outcome outcome)
        private
        returns (bytes32 challengeId)
    {
        ChallengeTypes.ChallengeExecution memory execution = _execution(nonce, side);
        challengeId = _active(nonce, side);
        vm.warp(execution.observationTime);
        vm.prank(RESOLVER);
        release.propose(challengeId, outcome, 0, EVIDENCE_HASH);
        vm.warp(execution.observationTime + execution.disputeWindowSeconds);
        release.finalizeUncontested(challengeId);
    }

    function _void(bytes32 nonce) private returns (bytes32 challengeId) {
        ChallengeTypes.ChallengeExecution memory execution =
            _execution(nonce, ChallengeTypes.Side.A);
        challengeId = _active(nonce, ChallengeTypes.Side.A);
        vm.warp(execution.proposalDeadline);
        release.voidUnproposed(challengeId);
    }

    function _execution(bytes32 nonce, ChallengeTypes.Side side)
        private
        view
        returns (ChallengeTypes.ChallengeExecution memory)
    {
        uint64 currentTime = uint64(block.timestamp);
        return ChallengeTypes.ChallengeExecution({
            nonce: nonce,
            createdAt: currentTime - 1,
            chainId: block.chainid,
            escrowContract: address(release),
            challengerWallet: challenger,
            challengerSide: side,
            token: address(token),
            tokenDecimals: 6,
            stakeAmount: STAKE,
            acceptanceDeadline: currentTime + 100,
            observationTime: currentTime + 200,
            sourceCorrectionCutoff: currentTime + 300,
            proposalDeadline: currentTime + 400,
            disputeWindowSeconds: 200,
            arbitrationWindowSeconds: 200,
            timeoutVoidAt: currentTime + 1_000
        });
    }

    function _assertClaimable(bytes32 challengeId, address wallet, uint256 amount) private view {
        ChallengeTypes.Entitlement memory entitlement = release.getEntitlement(challengeId, wallet);
        require(entitlement.exists && entitlement.claimableAmount == amount);
        require(entitlement.paidAmount == 0);
    }

    function _assertPaid(
        bytes32 challengeId,
        address wallet,
        uint256 amount,
        uint256 remainingChallengeLiability
    ) private view {
        ChallengeTypes.Entitlement memory entitlement = release.getEntitlement(challengeId, wallet);
        ChallengeTypes.Challenge memory challenge = release.getChallenge(challengeId);
        require(entitlement.exists && entitlement.claimableAmount == 0);
        require(entitlement.paidAmount == amount);
        require(challenge.outstandingLiability == remainingChallengeLiability);
    }

    function _setPaused(bool value) private {
        vm.prank(PAUSER);
        release.setPaused(value);
        require(release.paused() == value);
    }

    function _challengeSlot(bytes32 challengeId) private pure returns (bytes32) {
        return keccak256(abi.encode(challengeId, uint256(2)));
    }

    function _entitlementSlot(bytes32 challengeId, address wallet, uint256 offset)
        private
        pure
        returns (bytes32)
    {
        bytes32 outer = keccak256(abi.encode(challengeId, uint256(3)));
        return bytes32(uint256(keccak256(abi.encode(wallet, outer))) + offset);
    }

    function _findLog(VmSecurity.Log[] memory logs, bytes32 signature)
        private
        view
        returns (VmSecurity.Log memory found)
    {
        for (uint256 index = 0; index < logs.length; index++) {
            if (logs[index].emitter == address(release) && logs[index].topics[0] == signature) {
                return logs[index];
            }
        }
        revert("PAYMENT_EVENT_NOT_FOUND");
    }
}
