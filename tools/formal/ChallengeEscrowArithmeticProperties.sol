// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice Small, solver-facing lemmas for the arithmetic gates used by the release.
/// @dev This is a shadow specification, not a second payout implementation. The
///      production functions still need Foundry tests; these lemmas make their
///      preconditions and overflow boundary explicit to an SMT checker.
contract ChallengeEscrowArithmeticProperties {
    function stakePayoutIsRepresentable(uint256 stakeAmount) external pure {
        require(stakeAmount > 0);
        require(stakeAmount <= type(uint256).max / 2);

        uint256 payout = stakeAmount * 2;
        assert(payout == stakeAmount + stakeAmount);
        assert(payout >= stakeAmount);
    }

    function proposalDeadlineIsRepresentable(
        uint64 currentTime,
        uint64 proposalDeadline,
        uint64 disputeWindowSeconds,
        uint64 arbitrationWindowSeconds,
        uint64 timeoutVoidAt
    ) external pure {
        require(currentTime < proposalDeadline);
        uint256 latestProposalPath = uint256(proposalDeadline)
            + disputeWindowSeconds
            + arbitrationWindowSeconds;
        require(latestProposalPath <= timeoutVoidAt);

        assert(uint256(currentTime) + disputeWindowSeconds <= type(uint64).max);
        uint64 disputeDeadline = currentTime + disputeWindowSeconds;
        assert(uint256(disputeDeadline) == uint256(currentTime) + disputeWindowSeconds);
    }

    function arbitrationDeadlineIsRepresentable(
        uint64 currentTime,
        uint64 proposalDeadline,
        uint64 sourceCorrectionCutoff,
        uint64 disputeWindowSeconds,
        uint64 arbitrationWindowSeconds,
        uint64 timeoutVoidAt
    ) external pure {
        require(currentTime < proposalDeadline);
        require(sourceCorrectionCutoff < proposalDeadline);
        uint256 latestProposalPath = uint256(proposalDeadline)
            + disputeWindowSeconds
            + arbitrationWindowSeconds;
        uint256 latestCorrectionPath = uint256(sourceCorrectionCutoff)
            + arbitrationWindowSeconds;
        require(latestProposalPath <= timeoutVoidAt);
        require(latestCorrectionPath <= timeoutVoidAt);

        uint64 arbitrationStart = currentTime < sourceCorrectionCutoff
            ? sourceCorrectionCutoff
            : currentTime;
        assert(uint256(arbitrationStart) + arbitrationWindowSeconds <= type(uint64).max);
        uint64 arbitrationDeadline = arbitrationStart + arbitrationWindowSeconds;
        assert(
            uint256(arbitrationDeadline)
                == uint256(arbitrationStart) + arbitrationWindowSeconds
        );
    }

    function postTransferSolvencyGuardIsDominated(
        uint256 beforeBalance,
        uint256 aggregateLiability,
        uint256 amount,
        uint256 afterBalance
    ) external pure {
        // These are the exact preconditions established by _consumeAndPay and
        // ExactTokenDelta.pushExact before the final defensive branch.
        require(beforeBalance >= aggregateLiability);
        require(aggregateLiability >= amount);
        require(beforeBalance >= afterBalance);
        require(beforeBalance - afterBalance == amount);

        uint256 remainingLiability = aggregateLiability - amount;
        assert(afterBalance >= remainingLiability);
    }
}
