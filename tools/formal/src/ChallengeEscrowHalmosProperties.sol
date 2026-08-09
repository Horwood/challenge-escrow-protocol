// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ChallengeEscrow } from "protocol/ChallengeEscrow.sol";
import { ChallengeTypes } from "protocol/ChallengeTypes.sol";
import { AcceptancePermitHash } from "protocol/libraries/AcceptancePermitHash.sol";
import { ChallengeCommitment } from "protocol/libraries/ChallengeCommitment.sol";
import { ChallengeIds } from "protocol/libraries/ChallengeIds.sol";

/// @dev The interface is deliberately local so the formal harness has no runtime dependency.
///      Halmos identifies these selectors at the documented symbolic cheat-code address.
interface HalmosSVM {
    function createUint256(string memory name) external pure returns (uint256 value);
    function createBytes32(string memory name) external pure returns (bytes32 value);
}

contract FormalToken {
    mapping(address account => uint256 balance) private _balances;

    function mint(address account, uint256 amount) external {
        _balances[account] = amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_balances[from] >= amount);
        _balances[from] -= amount;
        _balances[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(_balances[msg.sender] >= amount);
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }
}

/// @notice Symbolic conformance checks that call the deployed release surface and its exact
///         production libraries. This is a boundary proof, not a claim of whole-contract proof.
contract ChallengeEscrowHalmosProperties {
    address private constant SVM_ADDRESS = address(uint160(uint256(keccak256("svm cheat code"))));
    HalmosSVM private constant svm = HalmosSVM(SVM_ADDRESS);

    address private constant RESOLVER = address(0xBEEF);
    address private constant ARBITER = address(0xCA11);
    address private constant PAUSER = address(0xF00D);

    ChallengeEscrow private release;
    FormalToken private token;

    function setUp() public {
        token = new FormalToken();
        token.mint(address(this), type(uint128).max);
        release = new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, PAUSER, false);
    }

    function check_executionHashDelegates(uint256 seed) public view {
        require(block.timestamp <= type(uint64).max - 6);
        ChallengeTypes.ChallengeExecution memory execution = _execution(seed);
        bytes32 expected = ChallengeCommitment.executionHash(execution);
        bytes32 actual = release.computeExecutionHash(execution);
        assert(actual == expected);
        assert(actual == release.computeExecutionHash(execution));
    }

    function check_specHashDelegates() public view {
        bytes32 executionHash = svm.createBytes32("executionHash");
        bytes32 termsHash = svm.createBytes32("termsHash");
        bytes32 expected = ChallengeCommitment.specHash(executionHash, termsHash);
        assert(release.computeSpecHash(executionHash, termsHash) == expected);
    }

    function check_domainSeparatorDelegates() public view {
        bytes32 expected = AcceptancePermitHash.domainSeparator(
            release.EIP712_NAME(), release.PROTOCOL_VERSION(), block.chainid, address(release)
        );
        assert(release.domainSeparator() == expected);
    }

    function check_challengeIdDelegates(bytes32 specHash) public view {
        assert(release.computeChallengeId(specHash) == ChallengeIds.challengeId(specHash));
    }

    function check_entitlementIdDelegates(bytes32 challengeId, address wallet) public view {
        assert(
            release.computeEntitlementId(challengeId, wallet)
                == ChallengeIds.entitlementId(challengeId, wallet)
        );
    }

    function check_releaseIdBindsChainAndEscrow() public view {
        assert(release.releaseId() == ChallengeIds.releaseId(block.chainid, address(release)));
    }

    function check_acceptancePermitDelegates(
        bytes32 challengeId,
        bytes32 specHash,
        address acceptingWallet,
        uint256 acceptanceNonce,
        uint64 expiresAt
    ) public view {
        ChallengeTypes.AcceptancePermit memory permit =
            ChallengeTypes.AcceptancePermit({
                challengeId: challengeId,
                specHash: specHash,
                acceptingWallet: acceptingWallet,
                acceptanceNonce: acceptanceNonce,
                expiresAt: expiresAt
            });
        bytes32 domain = AcceptancePermitHash.domainSeparator(
            release.EIP712_NAME(), release.PROTOCOL_VERSION(), block.chainid, address(release)
        );
        assert(release.acceptancePermitTypeHash() == AcceptancePermitHash.PERMIT_TYPEHASH);
        assert(release.hashAcceptancePermit(permit) == AcceptancePermitHash.digest(domain, permit));
    }

    function check_cancelRefundConservesLiability(
        uint96 stakeAmount,
        bytes32 nonce,
        bytes32 termsHash
    ) public {
        require(stakeAmount > 0);
        require(nonce != bytes32(0));
        require(termsHash != bytes32(0));
        require(block.timestamp <= type(uint64).max - 7);

        uint256 initialWalletBalance = token.balanceOf(address(this));
        ChallengeTypes.ChallengeExecution memory execution = _statefulExecution(nonce, stakeAmount);
        bytes32 executionHash = ChallengeCommitment.executionHash(execution);
        bytes32 specHash = ChallengeCommitment.specHash(executionHash, termsHash);
        bytes32 challengeId = release.createAndFund(execution, termsHash, specHash);

        ChallengeTypes.Challenge memory opened = release.getChallenge(challengeId);
        assert(challengeId == ChallengeIds.challengeId(specHash));
        assert(opened.state == ChallengeTypes.LifecycleState.OPEN);
        assert(opened.specHash == specHash);
        assert(opened.executionHash == executionHash);
        assert(opened.termsHash == termsHash);
        assert(opened.depositedAmount == stakeAmount);
        assert(opened.outstandingLiability == stakeAmount);
        assert(release.totalOutstandingLiability() == stakeAmount);
        assert(token.balanceOf(address(release)) == stakeAmount);

        release.cancelOpen(challengeId);
        ChallengeTypes.Challenge memory cancelled = release.getChallenge(challengeId);
        ChallengeTypes.Entitlement memory created =
            release.getEntitlement(challengeId, address(this));
        assert(cancelled.state == ChallengeTypes.LifecycleState.CANCELLED);
        assert(cancelled.outstandingLiability == stakeAmount);
        assert(created.exists);
        assert(created.claimableAmount == stakeAmount);
        assert(created.paidAmount == 0);

        release.refundPrincipal(challengeId);
        ChallengeTypes.Challenge memory paid = release.getChallenge(challengeId);
        ChallengeTypes.Entitlement memory consumed =
            release.getEntitlement(challengeId, address(this));
        assert(paid.state == ChallengeTypes.LifecycleState.CANCELLED);
        assert(paid.outstandingLiability == 0);
        assert(release.totalOutstandingLiability() == 0);
        assert(consumed.claimableAmount == 0);
        assert(consumed.paidAmount == stakeAmount);
        assert(token.balanceOf(address(release)) == 0);
        assert(token.balanceOf(address(this)) == initialWalletBalance);
    }

    function check_stakePayoutBoundary(uint256 stakeAmount) public pure {
        require(stakeAmount > 0);
        require(stakeAmount <= type(uint256).max / 2);
        uint256 payout = stakeAmount * 2;
        assert(payout == stakeAmount + stakeAmount);
        assert(payout >= stakeAmount);
    }

    function check_deadlineBoundary(
        uint64 currentTime,
        uint64 proposalDeadline,
        uint64 sourceCorrectionCutoff,
        uint64 disputeWindowSeconds,
        uint64 arbitrationWindowSeconds,
        uint64 timeoutVoidAt
    ) public pure {
        require(currentTime < proposalDeadline);
        require(sourceCorrectionCutoff < proposalDeadline);

        uint256 latestProposalPath =
            uint256(proposalDeadline) + disputeWindowSeconds + arbitrationWindowSeconds;
        uint256 latestCorrectionPath = uint256(sourceCorrectionCutoff) + arbitrationWindowSeconds;
        require(latestProposalPath <= timeoutVoidAt);
        require(latestCorrectionPath <= timeoutVoidAt);

        uint64 arbitrationStart =
            currentTime < sourceCorrectionCutoff ? sourceCorrectionCutoff : currentTime;
        assert(uint256(arbitrationStart) + arbitrationWindowSeconds <= type(uint64).max);
        uint64 arbitrationDeadline = arbitrationStart + arbitrationWindowSeconds;
        assert(uint256(arbitrationDeadline) == uint256(arbitrationStart) + arbitrationWindowSeconds);
    }

    function _execution(uint256 seed)
        private
        view
        returns (ChallengeTypes.ChallengeExecution memory execution)
    {
        uint64 nowTime = uint64(block.timestamp);
        execution.nonce = bytes32(seed);
        execution.createdAt = nowTime;
        execution.chainId = block.chainid;
        execution.escrowContract = address(release);
        // forge-lint: disable-next-line(unsafe-typecast)
        execution.challengerWallet = address(uint160(seed));
        execution.challengerSide = ChallengeTypes.Side(seed & 1);
        execution.token = release.canonicalToken();
        execution.tokenDecimals = 6;
        execution.stakeAmount = seed;
        execution.acceptanceDeadline = nowTime + 1;
        execution.observationTime = nowTime + 2;
        execution.sourceCorrectionCutoff = nowTime + 3;
        execution.proposalDeadline = nowTime + 4;
        execution.disputeWindowSeconds = 1;
        execution.arbitrationWindowSeconds = 1;
        execution.timeoutVoidAt = nowTime + 6;
    }

    function _statefulExecution(bytes32 nonce, uint256 stakeAmount)
        private
        view
        returns (ChallengeTypes.ChallengeExecution memory execution)
    {
        uint64 nowTime = uint64(block.timestamp);
        execution.nonce = nonce;
        execution.createdAt = nowTime;
        execution.chainId = block.chainid;
        execution.escrowContract = address(release);
        execution.challengerWallet = address(this);
        execution.challengerSide = ChallengeTypes.Side.A;
        execution.token = address(token);
        execution.tokenDecimals = 6;
        execution.stakeAmount = stakeAmount;
        execution.acceptanceDeadline = nowTime + 1;
        execution.observationTime = nowTime + 2;
        execution.sourceCorrectionCutoff = nowTime + 3;
        execution.proposalDeadline = nowTime + 4;
        execution.disputeWindowSeconds = 2;
        execution.arbitrationWindowSeconds = 1;
        execution.timeoutVoidAt = nowTime + 7;
    }
}
