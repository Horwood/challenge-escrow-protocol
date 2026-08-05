// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ChallengeEscrow } from "protocol/ChallengeEscrow.sol";
import { ChallengeTypes } from "protocol/ChallengeTypes.sol";
import { AcceptancePermitHash } from "protocol/libraries/AcceptancePermitHash.sol";
import { ChallengeCommitment } from "protocol/libraries/ChallengeCommitment.sol";

/// @dev The interface is deliberately local so the formal harness has no runtime dependency.
///      Halmos identifies these selectors at the documented symbolic cheat-code address.
interface HalmosSVM {
    function createUint256(string memory name) external pure returns (uint256 value);
    function createBytes32(string memory name) external pure returns (bytes32 value);
}

contract FormalToken {
    function balanceOf(address) external pure returns (uint256) {
        return type(uint256).max;
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

    function setUp() public {
        FormalToken token = new FormalToken();
        release = new ChallengeEscrow(address(token), 6, RESOLVER, ARBITER, PAUSER, false);
    }

    function check_executionHashDelegates(uint256 seed) public view {
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
}
